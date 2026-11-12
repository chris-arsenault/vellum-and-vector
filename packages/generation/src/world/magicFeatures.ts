import {
  magicSurfaceCode,
  magicEcologyFields,
  putChannel,
  surfaceRuleSources,
  type Band,
  type MagicSystem,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import { riverLayer } from "../water/riverKeeping";
import type { MagicField } from "./magicState";
import { magicKey } from "./magicState";
import { classifyNaturalSurface } from "./naturalSurface";
import { projectedValues } from "./atlasSampling";
import { growRegion, ruleCoverage } from "./magicRegions";
import { activeConfluences, evaluateConfluences } from "./magicConfluences";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import {
  magicChannels,
  magicEffectChannels,
  magicFieldDefinitions,
  publishedMagicChannels,
  societyChannels,
} from "./magicFieldDefinitions";

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
/** A second class shows through the first where it holds this share of the cell. */
export const secondSurfaceFloor = 0.2;
export function effectiveMagicRules(
  system: Pick<MagicField["definition"], "features" | "enabled" | "id">
) {
  return system.features.filter(
    (rule) => system.enabled || independentInteraction(rule, system.id)
  );
}
/** Current classification inputs follow the rules selected by each system. */
export function magicConditionRequirements(system: MagicSystem) {
  const fields: Record<string, string[]> = {
    elevation: ["field:Elevation"],
    slope: ["field:Elevation"],
    temperature: ["field:Temperature"],
    ice: ["field:IceThickness"],
    water: ["field:WaterKindCodes", "field:LakeOutletTargets"],
    moisture: ["field:Moisture"],
    geothermal: ["field:Geothermal"],
    fracture: ["field:FractureConductance"],
    landform: ["field:LandformCodes"],
    river: [`field:${riverLayer}`],
    upwelling: ["field:OceanCurrentX"],
  };
  return effectiveMagicRules(system)
    .flatMap((rule) => [...rule.seeds, ...(rule.retains ?? [])].flat())
    .flatMap((condition) =>
      Object.hasOwn(magicEcologyFields, condition.field)
        ? ["ecology"]
        : (fields[condition.field] ?? [])
    );
}
/**
 * Grow every effective rule of every system and measure its coverage. A system's coverage in
 * a cell is the most any of its classes occupies there. Confluences read this, so it runs
 * before them in each evaluation and again at classification.
 */
export function coverSystems(state: GenerationState, seed: number) {
  const magic = state.physical!.magic!;
  for (const field of magic.fields) {
    releaseWorking(
      state.physical!.map,
      ...Object.values(field.features),
      ...Object.values(field.coverage)
    );
    field.features = {};
    field.coverage = {};
    field.systemCoverage.fill(0);
    for (const rule of effectiveMagicRules(field.definition)) {
      const members = growRegion(state, field, rule, seed),
        coverage = ruleCoverage(state, field, rule, members, seed);
      field.features[rule.id] = members;
      field.coverage[rule.id] = coverage;
      for (let i = 0; i < coverage.length; i++)
        field.systemCoverage.set(i, Math.max(field.systemCoverage.get(i), coverage.get(i)));
    }
  }
}
/**
 * The presentation raster: one code per cell, the highest-priority class among the systems'
 * rules and the confluences. The model beneath keeps every class and its coverage.
 */
export function classifyMagicFeatures(state: GenerationState, seed = state.domain.world.seed) {
  classifyNaturalSurface(state);
  const magic = state.physical!.magic!;
  coverSystems(state, seed);
  evaluateConfluences(state, seed, false);
  const map = state.physical!.map,
    held = workingArray(map, "float64", "magic:surface-share").fill(-Infinity),
    priority = workingArray(map, "float64", "magic:surface-priority").fill(-Infinity),
    second = workingArray(map, "float64", "magic:surface-second");
  magic.secondSurface.fill(-1);
  const sources = surfaceRuleSources(
    magic.fields.map((field) => field.definition),
    magic.confluences.definitions
  );
  // The class with the largest coverage takes the cell, priority breaking ties; the next
  // largest is the second code where it holds at least the floor of the ground.
  const place = (i: number, code: number, rulePriority: number, share: number) => {
    const current = held.get(i);
    if (share > current || (share === current && rulePriority > priority.get(i))) {
      if (current >= secondSurfaceFloor) {
        magic.secondSurface.set(i, magic.finalSurface.get(i));
        second.set(i, current);
      }
      magic.finalSurface.set(i, code);
      held.set(i, share);
      priority.set(i, rulePriority);
    } else if (share > second.get(i) && share >= secondSurfaceFloor) {
      magic.secondSurface.set(i, code);
      second.set(i, share);
    }
  };
  const paint = (code: number, rulePriority: number, members: Band, coverage?: Band) => {
    for (let i = 0; i < members.length; i++) {
      const share = coverage?.get(i) ?? 1;
      if (members.get(i) && share > 0) place(i, code, rulePriority, share);
    }
  };
  for (const field of magic.fields)
    for (const rule of effectiveMagicRules(field.definition))
      paint(
        magicSurfaceCode(sources, field.definition.id, rule.id)!,
        rule.priority,
        field.features[rule.id],
        field.coverage[rule.id]
      );
  for (const held of Object.values(magic.confluences.states))
    paint(
      magicSurfaceCode(sources, "confluence", held.definition.id)!,
      held.definition.priority,
      held.members,
      held.coverage
    );
  releaseWorking(map, held, priority, second);
}
type ChannelProjector = (
  key: import("@atlas/domain").FieldChannelName,
  unit: string,
  values: Pick<Band, "get">,
  quantity: "intensive" | "extensive" | "category"
) => void;

export function projectMagic(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic;
  if (!magic) return;
  const project: ChannelProjector = (key, unit, values, quantity) =>
    putChannel(state.surface, key, unit, projectedMagicValues(state, values, quantity), quantity);
  project("naturalSurface", "category", magic.naturalSurface, "category");
  project("finalSurface", "category", magic.finalSurface, "category");
  project("secondSurface", "category", magic.secondSurface, "category");
  for (const name of magicEffectChannels) project(name, "ratio", work.map[name], "intensive");
  for (const [name, unit] of societyChannels) project(name, unit, work.map[name], "extensive");
  project("magic:strain", "ratio", magic.confluences.strain, "intensive");
  for (const field of magic.fields) projectSystem(field, project);
  for (const confluence of activeConfluences(state)) {
    const held = magic.confluences.states[confluence.id];
    if (!held) continue;
    project(`magic:confluence:${confluence.id}:members`, "category", held.members, "category");
    project(`magic:confluence:${confluence.id}:coverage`, "ratio", held.coverage, "intensive");
  }
}
function projectSystem(field: MagicField, project: ChannelProjector) {
  for (const channel of publishedMagicChannels)
    project(
      magicKey(field, channel),
      magicFieldDefinitions[channel].unit,
      field[channel],
      magicFieldDefinitions[channel].quantity
    );
  for (const [id, values] of Object.entries(field.originSources))
    project(magicKey(field, `origin:${id}:source`), "relative-intensity", values, "intensive");
  project(magicKey(field, "coverage"), "ratio", field.systemCoverage, "intensive");
  for (const [key, values] of Object.entries(field.stocks))
    project(magicKey(field, `stock:${key}`), "intensity-square-metre", values, "extensive");
  for (const [id, members] of Object.entries(field.features)) {
    project(magicKey(field, `feature:${id}`), "category", members, "category");
    project(magicKey(field, `coverage:${id}`), "ratio", field.coverage[id], "intensive");
  }
}
/** Resample amounts by represented area; retain the owner's values for every other quantity. */
export function projectedMagicValues(
  state: GenerationState,
  values: Pick<Band, "get">,
  quantity: "intensive" | "extensive" | "category"
) {
  const work = state.physical!;
  if (quantity !== "extensive")
    return projectedValues(work, (cell) => values.get(cell), quantity === "category");
  const density = workingValues(work.map, "float64", "magic:project-density", (i) =>
    work.map.mesh.area(i) > 0 ? values.get(i) / work.map.mesh.area(i) : 0
  );
  const output = projectedValues(work, density);
  for (let i = 0; i < output.length; i++)
    output.set(i, output.get(i) * state.surface.measures.get(i));
  releaseWorking(work.map, density);
  return output;
}
