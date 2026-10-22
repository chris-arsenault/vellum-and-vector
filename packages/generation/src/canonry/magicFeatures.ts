import {
  replaceChannel,
  geometryParts,
  spatial,
  putChannel,
  type PreparedChannelData,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { magicKey } from "./magicState";
import { classifyNaturalSurface } from "./naturalSurface";
import { projectedValues } from "./atlasSampling";
import {
  magicChannels,
  magicFieldDefinitions,
  publishedMagicChannels,
} from "./magicFieldDefinitions";
import { magicRegionCompiler } from "./magicRegionField";
import { any, regionTracer } from "./causalRegions";
import { sampleCategory } from "./categoryGeography";

export function independentInteraction(
  rule: MagicField["definition"]["features"][number],
  owner: string
) {
  const conditions = [...rule.seeds, ...(rule.retains ?? [])].flat();
  const local = new Set<string>([...magicChannels, `system:${owner}`]);
  return (
    conditions.some((test) => test.field.startsWith("system:")) &&
    conditions.every((test) => !local.has(test.field))
  );
}
export function effectiveMagicRules(system: MagicField["definition"]) {
  return system.features.filter(
    (rule) => system.enabled || independentInteraction(rule, system.id)
  );
}
export function classifyMagicFeatures(state: GenerationState, seed = state.domain.world.seed) {
  if (!state.physical!.map.continuous?.geography) classifyNaturalSurface(state);
  const magic = state.physical!.magic!;
  magic.classificationSeed = seed;
  const categories = state.surface.geography!.categories!;
  const compile = magicRegionCompiler(state),
    trace = regionTracer(state);
  const overlays: { code: number; footprint: Geometry; priority: number }[] = [];
  let code = 100;
  for (const field of magic.fields) {
    field.features = {};
    const effective = new Set(effectiveMagicRules(field.definition));
    for (const rule of field.definition.features) {
      const surfaceCode = code++;
      if (!effective.has(rule)) continue;
      const seedRegion = compile(field, rule.seeds),
        seeds = trace(seedRegion);
      const retained = seeds && trace(any(seedRegion, compile(field, rule.retains ?? rule.seeds)));
      const seedOverlap = seeds && spatial.intersectionArea(seeds);
      const parts = retained
        ? geometryParts(retained).filter((part) => {
            if (part.type !== "Polygon") return false;
            return seedOverlap!(part) > 0;
          })
        : [];
      const members = new Uint8Array(magic.finalSurface.length),
        key = magicKey(field, `feature:${rule.id}`);
      field.features[rule.id] = members;
      categories[key] = {
        fallback: 0,
        entries: parts.map((footprint) => ({ code: 1, footprint })),
      };
      putChannel(state.surface, key, "category", members, "category");
      sampleCategory(state, key, members);
      overlays.push(
        ...parts.map((footprint) => ({ code: surfaceCode, footprint, priority: rule.priority }))
      );
    }
  }
  // Stable ordering preserves the first configured rule when priorities tie.
  overlays.sort((a, b) => b.priority - a.priority);
  const natural = categories.naturalSurface;
  categories.finalSurface = {
    fallback: natural.fallback,
    entries: [...overlays.map(({ code, footprint }) => ({ code, footprint })), ...natural.entries],
  };
  putChannel(state.surface, "finalSurface", "category", magic.finalSurface, "category");
  sampleCategory(state, "finalSurface", magic.finalSurface);
}
export function projectMagic(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic;
  if (!magic) return;
  const geography = work.map.continuous?.geography;
  const categories = geography?.categories && { ...geography.categories };
  const project = (
    key: string,
    unit: string,
    values: ArrayLike<number>,
    quantity: "intensive" | "extensive" | "category",
    prepared?: PreparedChannelData
  ) => {
    if (quantity === "intensive" && !prepared?.coefficients && !prepared?.adaptive)
      throw new Error(`Prepare ${key} before publication.`);
    replaceChannel(state.surface, key, unit, projectedValues(values), quantity, prepared);
  };
  project("naturalSurface", "category", magic.naturalSurface, "category");
  project("finalSurface", "category", magic.finalSurface, "category");
  for (const field of magic.fields) {
    for (const channel of publishedMagicChannels)
      project(
        magicKey(field, channel),
        magicFieldDefinitions[channel].unit,
        field[channel],
        magicFieldDefinitions[channel].quantity,
        { coefficients: field.coefficients?.[channel], adaptive: field.adaptive?.[channel] }
      );
    for (const [id, members] of Object.entries(field.features))
      project(magicKey(field, `feature:${id}`), "category", members, "category");
    for (const [name, entries] of Object.entries(field.occurrences ?? {}))
      ((state.surface.geography ??= {}).occurrences ??= {})[magicKey(field, name)] = entries;
  }
  if (categories) (state.surface.geography ??= {}).categories = categories;
}
