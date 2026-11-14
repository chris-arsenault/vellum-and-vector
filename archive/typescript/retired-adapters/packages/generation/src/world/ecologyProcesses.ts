import {
  MapScale,
  areaSpace,
  biomes,
  spatial,
  requireThat,
  ecologyEpochSchema,
  type Band,
} from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { generationFeatures } from "../generationFeatures";
import { composeNativeAuthoring, nativePosition } from "./atlasWorkspace";
import { environment, classifyBiome, unit } from "./ecologyEnvironment";
import { evolveVegetation } from "./ecologyVegetation";
import { geologicalYears } from "./ecologySoils";
import { readEcologyEnvironment } from "./ecologyEnvironmentRead";
import { nativeContext } from "./context";
import { accumulateOrganicMatter, evolveBuriedCarbon } from "./ecologyCarbon";
import { ecologyRatios, ecologyScalars } from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { initializeEcology } from "./ecologyEstablishment";
import { authoritativeCanopy, updateTreeCover, normalizeCommunities } from "./ecologyGrowth";
import { plantGroups, livingPlantCarbon } from "./ecologyGroups";
import { ecologicalForcing } from "./ecologyMagic";
import { erosionHistory } from "./ecologySoils";
import { generationBindings, physicalEpochIndex } from "../generationBindings";
import { atlasParametersSchema, type AtlasParameters } from "../atlasParameters";
import type { Epoch } from "@atlas/domain";
import {
  mapCommand,
  mapElapsed,
  mapQuery,
  type MapInput,
  type MapOperation,
} from "../processTraits";
import { defineCommand } from "../processOperation";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { isMutablePhysicalName, type PhysicalField } from "./field";

interface EcologyInput {
  seed: number;
  parameters: AtlasParameters;
  epochs: Epoch[];
}
function ecologyInput(input: AtlasGenerationInput, context: MapProcessContext): EcologyInput {
  if (context.inputs?.features) {
    const bound = generationBindings(context);
    return {
      seed: bound.seed,
      parameters: bound.parameters,
      epochs: bound.settings.epochs,
    };
  }
  return {
    seed: input.seed,
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    epochs: input.settings?.epochs ?? [],
  };
}

function forcing(state: GenerationState, input: EcologyInput, context?: MapProcessContext) {
  const epoch = input.epochs[physicalEpochIndex(input.epochs, context?.epochs ?? [])];
  const ecology = ecologyEpochSchema.parse(epoch?.ecology ?? {});
  return ecologicalForcing(state, input.parameters, ecology);
}
function coverAuthority(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  const woodland = workingArray(map, "uint8", "ecology:authored-woodland");
  for (const feature of generationFeatures(state, { kind: "forest" })) {
    if (
      feature.state === "generated" ||
      areaSpace(state.domain.world, feature.areaId) !== state.domain.scope.spaceId ||
      !spatial.intersects(feature.geometry, state.domain.scope.footprint)
    )
      continue;
    const covers = spatial.pointCoverage(feature.geometry);
    for (let i = 0; i < map.mesh.count; i++) {
      if (!covers(nativePosition(work, i))) continue;
      woodland.set(i, 1);
    }
  }
  const fixed = work.fixed.filter(({ binding }) =>
    (ecologyScalars as readonly string[]).includes(binding.name)
  );
  return (i: number) => {
    if (woodland.get(i)) {
      map.TreeCover.set(i, Math.max(0.7, map.TreeCover.get(i)));
      map.GrassCover.set(i, Math.min(0.2, map.GrassCover.get(i)));
      map.WetlandCover.set(i, Math.min(0.1, map.WetlandCover.get(i)));
    }
    for (const { binding, values } of fixed) {
      const value = values.get(i);
      if (Number.isFinite(value) && isMutablePhysicalName(binding.name))
        map[binding.name].set(i, value);
    }
    if (
      woodland.get(i) ||
      fixed.some(
        ({ binding, values }) => binding.name === "TreeCover" && Number.isFinite(values.get(i))
      )
    )
      authoritativeCanopy(map, i, map.TreeCover.get(i));
    else updateTreeCover(map, i);
  };
}
function applyWoodlands(state: GenerationState) {
  const restore = coverAuthority(state),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) restore(i);
  composeNativeAuthoring(state.physical!);
}
function initialize(state: GenerationState, seed: number) {
  const map = state.physical!.map;
  initializeEcology(map, seed, state.physical!.inherited);
  for (let i = 0; i < map.mesh.count; i++) {
    map.EcologySediment.set(i, MapScale.metres(map.SedimentThickness.get(i), "native"));
    map.EcologyVolcanic.set(i, MapScale.metres(map.VolcanicConstructionHistory.get(i), "native"));
    map.EcologyImpact.set(i, MapScale.metres(map.ImpactExcavation.get(i), "native"));
    map.EcologyErosion.set(i, erosionHistory(map, i));
    map.EcologyIce.set(i, map.IceThickness.get(i));
  }
  applyWoodlands(state);
}
function present(state: GenerationState, context: MapProcessContext, seed: number) {
  const map = state.physical!.map;
  readEcologyEnvironment(map, nativeContext(state, context, 0));
  initializeEcology(map, seed, true);
  const restore = coverAuthority(state);
  for (let i = 0; i < map.mesh.count; i++) {
    const env = environment(map, i);
    const stress = presentStress(env);
    if (stress > 0) presentMortality(map, i, stress, restore);
    normalizeCommunities(map, i);
    updateTreeCover(map, i);
  }
  applyWoodlands(state);
  for (let i = 0; i < map.mesh.count; i++) map.BiomeCodes.set(i, classifyBiome(map, i));
  composeNativeAuthoring(state.physical!);
}
function presentStress(env: ReturnType<typeof environment>) {
  return env.frozen || env.submerged ? 1 : unit((env.temperature - 50) / 15);
}
function presentMortality(
  map: PhysicalField,
  i: number,
  stress: number,
  restore: (i: number) => void
) {
  const previous = livingPlantCarbon(map, i),
    survival = 1 - stress;
  for (const group of plantGroups) {
    map[group.cover].set(i, map[group.cover].get(i) * survival);
    if (group.juvenile) map[group.juvenile].set(i, map[group.juvenile].get(i) * survival);
  }
  updateTreeCover(map, i);
  restore(i);
  map.SoilCarbon.add(i, Math.max(0, previous - livingPlantCarbon(map, i)));
  for (const name of ["Productivity", "Herbivores", "Predators", "Grazers", "Browsers"] as const)
    map[name].set(i, map[name].get(i) * survival);
}
function recordEcology(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map;
  const areas = new Float64Array(biomes.length);
  let migration = 0,
    burned = 0,
    grazers = 0,
    browsers = 0,
    predators = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const area = map.mesh.contentArea(i);
    areas[map.BiomeCodes.get(i)] += area;
    migration += map.MigrationFlux.get(i) * area;
    burned += map.FireActivity.get(i) * area;
    grazers += map.Grazers.get(i) * area;
    browsers += map.Browsers.get(i) * area;
    predators += map.Predators.get(i) * area;
  }
  const cover = biomes
    .map((biome, i) =>
      areas[i] > 0
        ? `${biome.name}: ${Math.round(MapScale.areaUnits(areas[i], "m2", "km2"))} km²`
        : ""
    )
    .filter(Boolean)
    .join(", ");
  const duration = state.physical!.inherited ? 0 : (context.epochs.at(-1)?.duration ?? 0);
  context.recordCause({
    kind: "domain",
    process: "atlas.ecology",
    subjects: [],
    description: `${duration} years of establishment, competition, cohort growth, migration and disturbance${state.physical!.inherited ? " (inherited ecology is refined without replaying its age)" : ""}. ${cover}. Fire-affected cover ${Math.round(MapScale.areaUnits(burned, "m2", "km2"))} km². Grazers/browsers/predators ${Math.round(grazers)}/${Math.round(browsers)}/${Math.round(predators)} kg C; migrated ${Math.round(migration)} kg C through reachable habitat. Soil and seed banks carry this epoch's ecological consequences forward.`,
  });
}
function recordTransitions(state: GenerationState, before: Band, context: MapProcessContext) {
  const map = state.physical!.map,
    changes = new Map<string, number>();
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const was = before.get(i),
      now = map.BiomeCodes.get(i);
    if (!was || was === now) continue;
    const change = `${biomes[was].name} → ${biomes[now].name}`;
    changes.set(change, (changes.get(change) ?? 0) + map.mesh.contentArea(i));
  }
  if (!changes.size) return;
  context.recordCause({
    kind: "domain",
    process: "atlas.ecology-succession",
    subjects: [],
    description: [...changes]
      .map(([change, area]) => `${change}: ${MapScale.areaUnits(area, "m2", "km2").toFixed(1)} km²`)
      .join("; "),
  });
}
/** The first cell whose value fails the predicate, or -1. */
function firstFailing(band: Band, holds: (value: number) => boolean) {
  for (let i = 0; i < band.length; i++) if (!holds(band.get(i))) return i;
  return -1;
}
function validate(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map;
  for (const name of ecologyScalars) {
    const band = map[name],
      invalid = firstFailing(band, (value) => Number.isFinite(value) && value >= 0);
    requireThat(
      invalid < 0,
      "ecology_field",
      `Ecology ${name} must remain finite and nonnegative (${context.invocation.join("/")}, cell ${invalid}, value ${invalid < 0 ? 0 : band.get(invalid)}).`
    );
  }
  for (const name of ecologyRatios)
    requireThat(
      firstFailing(map[name], (value) => value <= 1.000001) < 0,
      "ecology_cover",
      `Ecology ${name} must remain a fraction.`
    );
  return [];
}
export function ecologyProcesses(input: AtlasGenerationInput): MapProcess[] {
  return ["initialize", "evolve", "respond", "burial", "settle", "present"].map((name) => ({
    contract: {
      id: `atlas.ecology-${name}`,
      version: "1",
      parameters: {},
      requires: ecologyRequirements(name),
      produces: ecologyProducts(name),
      invalidates: [],
      products: [{ id: "atlas:ecology-response", lifetime: "epoch", representation: "history" }],
      workspaceOnly: true,
    },
    operation: ecologyOperation(name, input),
    validate,
  }));
}
function ecologyOperation(name: string, input: AtlasGenerationInput): MapOperation {
  const id = `atlas.ecology-${name}`;
  if (name === "initialize")
    return mapCommand(
      id,
      "initialize",
      (state, context) => initialize(state, ecologyInput(input, context).seed),
      []
    );
  if (["evolve", "respond"].includes(name))
    return mapElapsed(
      id,
      { kind: "epoch", fraction: 0.5 },
      (state, context, years) => {
        if (name === "evolve" && !state.physical!.inherited)
          state.physical!.map.MigrationFlux.fill(0);
        advance(state, context, ecologyInput(input, context), years);
      },
      []
    );
  if (name === "burial")
    return mapElapsed(
      id,
      { kind: "epoch", fraction: 1 },
      (state, context, years) => {
        evolveBuriedCarbon(state.physical!.map, state.physical!.inherited ? 0 : years);
        present(state, context, ecologyInput(input, context).seed);
        recordEcology(state, context);
      },
      []
    );
  if (name === "present") return mapQuery(id, classifyCurrentEcology, []);
  if (name === "settle")
    return mapCommand(
      id,
      "event",
      (state, context) => {
        const { seed } = ecologyInput(input, context);
        present(state, context, seed);
      },
      []
    );
  throw new Error(`Unknown ecology operation: ${name}`);
}

/** Presentation reads retained communities; mortality belongs to ecological development. */
function classifyCurrentEcology(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map;
  readEcologyEnvironment(map, nativeContext(state, context, 0));
  for (let i = 0; i < map.mesh.count; i++) map.BiomeCodes.set(i, classifyBiome(map, i));
}
function ecologyRequirements(name: string) {
  if (name === "initialize") return ["atlas:workspace", "field:Elevation"];
  // Burial consumes the retained response's epoch climate and new coastal
  // deposition, rather than claiming climate was recomputed after coastal work.
  if (name === "burial") return ["atlas:workspace", "atlas:ecology-response"];
  const required = [
    "atlas:workspace",
    "atlas:ecology-initialized",
    "field:Temperature",
    "field:Moisture",
  ];
  if (["evolve", "respond"].includes(name)) required.push("field:FlowTargets");
  return required;
}
function ecologyProducts(name: string) {
  if (name === "initialize") return ["atlas:ecology-initialized", "ecology"];
  if (name === "respond") return ["atlas:ecology-response", "ecology"];
  return ["ecology"];
}
function advance(
  state: GenerationState,
  context: MapProcessContext,
  input: EcologyInput,
  years: number,
  newHumanTime = false
) {
  if (state.physical!.inherited && !newHumanTime) return;
  applyWoodlands(state);
  const f = forcing(state, input, context);
  const map = state.physical!.map,
    before = map.coverage.copyBand(map.BiomeCodes);
  const land = nativeContext(state, context, 0);
  readEcologyEnvironment(map, land);
  evolveVegetation(
    map,
    years,
    f,
    coverAuthority(state),
    input.seed ^ Math.imul(physicalEpochIndex(input.epochs, context.epochs) + 1, 16777619),
    // What the land wore since plants were last followed, it wore over the epoch's own span.
    newHumanTime ? years : Math.max(years, geologicalYears(land.TectonicDurationMyr))
  );
  applyWoodlands(state);
  accumulateOrganicMatter(map, years, f);
  recordTransitions(state, before, context);
  releaseWorking(map, before);
}

/** New elapsed human time is distinct from spatial refinement of completed history. */
export const advanceHumanEcology = defineCommand(
  "ecology.human-time",
  "elapsed",
  ({ state, context, years }: MapInput & { years: number }) => {
    const bound = generationBindings(context);
    const era = context.epochs.at(-1);
    const named = bound.settings.epochs.findIndex((e) => e.id === era?.parentEpoch);
    const index = named >= 0 ? named : bound.settings.epochs.length - 1;
    advance(
      state,
      { ...context, epochIndices: [index] },
      {
        seed: bound.seed,
        parameters: bound.parameters,
        epochs: bound.settings.epochs,
      },
      years,
      true
    );
  },
  []
);
