import {
  areaSpace,
  biomes,
  spatial,
  requireThat,
  ecologyEpochSchema,
  type MagicSystem,
} from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { composeNativeAuthoring, nativePosition } from "./atlasWorkspace";
import { environment, classifyBiome, unit, type EcologyForcing } from "./ecologyEnvironment";
import { evolveVegetation } from "./ecologyVegetation";
import { accumulateOrganicMatter, evolveBuriedCarbon } from "./ecologyCarbon";
import { ecologyRatios, ecologyScalars } from "./ecologyState";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { initializeEcology } from "./ecologyEstablishment";
import { authoritativeCanopy, updateTreeCover, normalizeCommunities } from "./ecologyGrowth";
import { plantGroups, livingPlantCarbon } from "./ecologyGroups";
import { alterEcology } from "./ecologyMagic";
import { erosionHistory } from "./ecologySoils";
import { generationBindings } from "../generationBindings";
import { atlasParametersSchema, type AtlasParameters } from "../atlasParameters";
import type { Epoch } from "@atlas/domain";
import type { ProcessBehavior } from "../processTraits";

interface EcologyInput {
  seed: number;
  parameters: AtlasParameters;
  epochs: Epoch[];
  physical: boolean;
}
function ecologyInput(input: AtlasGenerationInput, context: MapProcessContext): EcologyInput {
  if (context.inputs?.features) {
    const bound = generationBindings(context);
    return {
      seed: bound.seed,
      parameters: bound.parameters,
      epochs: bound.settings.epochs,
      physical: bound.domains.includes("physical"),
    };
  }
  return {
    seed: input.seed,
    parameters: atlasParametersSchema.parse(input.parameters ?? {}),
    epochs: input.settings?.epochs ?? [],
    physical: input.domains.includes("physical"),
  };
}

export const ecologicalMagicEffectBindings = {
  vegetationGrowth: "growth",
  fire: "fire",
  organicPreservation: "preservation",
  ecologicalAlteration: "alteration",
  plantColdTolerance: "coldTolerance",
  plantDroughtTolerance: "droughtTolerance",
  animalToxicity: "toxicity",
  seedDispersal: "dispersal",
} as const satisfies Partial<Record<keyof MagicSystem["effects"], keyof EcologyForcing>>;
export const ecologicalMagicEffects = Object.keys(
  ecologicalMagicEffectBindings
) as (keyof typeof ecologicalMagicEffectBindings)[];

function magicalEcologyForcing(state: GenerationState, i: number) {
  const result = {
    growth: 0,
    fire: 0,
    preservation: 0,
    alteration: 0,
    coldTolerance: 0,
    droughtTolerance: 0,
    toxicity: 0,
    dispersal: 0,
  };
  for (const field of state.physical!.magic?.fields ?? []) {
    if (!field.definition.enabled) continue;
    const intensity = field.intensity[i] / 1000;
    for (const effect of ecologicalMagicEffects)
      result[ecologicalMagicEffectBindings[effect]] += intensity * field.definition.effects[effect];
  }
  return result;
}
function forcing(state: GenerationState, input: EcologyInput, context?: MapProcessContext) {
  const epoch = input.epochs[context?.epochIndices[0] ?? input.epochs.length - 1];
  const ecology = ecologyEpochSchema.parse(epoch?.ecology ?? {});
  const map = state.physical!.map;
  return (i: number): EcologyForcing => {
    return {
      ...magicalEcologyForcing(state, i),
      // Shared fields the magic feedback wrote; absent systems leave them at zero.
      quickening: map.Quickening[i],
      stillness: map.Stillness[i],
      productivity: (input.parameters?.vegetation ?? 1) * ecology.productivity,
      grazing: input.parameters?.grazing ?? 1,
      seasonality: ecology.seasonality,
      migration: ecology.migration,
      recovery: ecology.recovery,
      fireRegime: ecology.fire,
    };
  };
}
function coverAuthority(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  const woodlands = Object.values(state.domain.world.features).filter(
    (feature) =>
      feature.kind === "forest" &&
      feature.state !== "generated" &&
      areaSpace(state.domain.world, feature.areaId) === state.domain.scope.spaceId &&
      spatial.intersects(feature.geometry, state.domain.scope.footprint)
  );
  const woodland = new Uint8Array(map.mesh.count);
  for (const feature of woodlands) {
    const covers = spatial.pointCoverage(feature.geometry);
    for (let i = 0; i < map.mesh.count; i++) {
      if (!covers(nativePosition(work, i))) continue;
      woodland[i] = 1;
    }
  }
  const fixed = work.fixed.filter(({ binding }) =>
    (ecologyScalars as readonly string[]).includes(binding.native)
  );
  return (i: number) => {
    if (woodland[i]) {
      map.TreeCover[i] = Math.max(0.7, map.TreeCover[i]);
      map.GrassCover[i] = Math.min(0.2, map.GrassCover[i]);
      map.WetlandCover[i] = Math.min(0.1, map.WetlandCover[i]);
    }
    for (const { binding, values } of fixed)
      if (Number.isFinite(values[i])) map[binding.native][i] = values[i];
    if (
      woodland[i] ||
      fixed.some(
        ({ binding, values }) => binding.native === "TreeCover" && Number.isFinite(values[i])
      )
    )
      authoritativeCanopy(map, i, map.TreeCover[i]);
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
    map.EcologySediment[i] = map.SedimentThickness[i] / 1024;
    map.EcologyVolcanic[i] = map.VolcanicConstructionHistory[i] / 1024;
    map.EcologyImpact[i] = map.ImpactExcavation[i] / 1024;
    map.EcologyErosion[i] = erosionHistory(map, i);
    map.EcologyIce[i] = map.IceThickness[i];
  }
  applyWoodlands(state);
}
function present(
  state: GenerationState,
  seed: number,
  input?: EcologyInput,
  context?: MapProcessContext
) {
  const map = state.physical!.map;
  initializeEcology(map, seed, true);
  const restore = coverAuthority(state);
  const magic = input ? forcing(state, input, context) : null;
  if (magic) alterEcology(map, 0, magic);
  for (let i = 0; i < map.mesh.count; i++) {
    const env = environment(map, i);
    const fire = magic ? unit(magic(i).fire) : 0;
    const stress = presentStress(env);
    if (fire > 0) map.FireActivity[i] = fire;
    if (stress > 0 || fire > 0) presentMortality(map, i, stress, fire, restore);
    normalizeCommunities(map, i);
    updateTreeCover(map, i);
  }
  applyWoodlands(state);
  for (let i = 0; i < map.mesh.count; i++) map.BiomeCodes[i] = classifyBiome(map, i);
  composeNativeAuthoring(state.physical!);
}
function presentStress(env: ReturnType<typeof environment>) {
  return env.frozen || env.submerged ? 1 : unit((env.temperature - 50) / 15);
}
function presentMortality(
  map: import("./field").PhysicalField,
  i: number,
  stress: number,
  fire: number,
  restore: (i: number) => void
) {
  const previous = livingPlantCarbon(map, i);
  for (const group of plantGroups) {
    map[group.cover][i] *= (1 - stress) * (1 - fire);
    if (group.juvenile) map[group.juvenile][i] *= (1 - stress) * (1 - fire);
  }
  updateTreeCover(map, i);
  restore(i);
  map.SoilCarbon[i] += Math.max(0, previous - livingPlantCarbon(map, i)) * (1 - fire);
  for (const name of ["Productivity", "Herbivores", "Predators", "Grazers", "Browsers"] as const)
    map[name][i] *= (1 - stress) * (1 - fire);
}
function recordEcology(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map;
  const areas = new Float64Array(biomes.length);
  let migration = 0,
    altered = 0,
    burned = 0,
    grazers = 0,
    browsers = 0,
    predators = 0;
  for (let i = 0; i < map.mesh.contentCount; i++) {
    areas[map.BiomeCodes[i]] += map.mesh.contentAreas[i];
    const area = map.mesh.contentAreas[i];
    migration += map.MigrationFlux[i] * area;
    altered += map.AlteredCover[i] * area;
    burned += map.FireActivity[i] * area;
    grazers += map.Grazers[i] * area;
    browsers += map.Browsers[i] * area;
    predators += map.Predators[i] * area;
  }
  const cover = biomes
    .map((biome, i) => (areas[i] > 0 ? `${biome.name}: ${Math.round(areas[i] / 1e6)} km²` : ""))
    .filter(Boolean)
    .join(", ");
  const duration = state.physical!.inherited ? 0 : (context.epochs.at(-1)?.duration ?? 0);
  context.recordCause({
    kind: "domain",
    process: "atlas.ecology",
    subjects: [],
    description: `${duration} years of establishment, competition, cohort growth, migration and disturbance${state.physical!.inherited ? " (inherited ecology is refined without replaying its age)" : ""}. ${cover}. Altered canopy ${Math.round(altered / 1e6)} km²; fire-affected cover ${Math.round(burned / 1e6)} km². Grazers/browsers/predators ${Math.round(grazers)}/${Math.round(browsers)}/${Math.round(predators)} kg C; migrated ${Math.round(migration)} kg C through reachable habitat. Soil and seed banks carry this epoch's ecological consequences forward.`,
  });
}
function recordTransitions(state: GenerationState, before: Int32Array, context: MapProcessContext) {
  const map = state.physical!.map,
    changes = new Map<string, number>();
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (!before[i] || before[i] === map.BiomeCodes[i]) continue;
    const change = `${biomes[before[i]].name} → ${biomes[map.BiomeCodes[i]].name}`;
    changes.set(change, (changes.get(change) ?? 0) + map.mesh.contentAreas[i]);
  }
  if (!changes.size) return;
  context.recordCause({
    kind: "domain",
    process: "atlas.ecology-succession",
    subjects: [],
    description: [...changes]
      .map(([change, area]) => `${change}: ${(area / 1e6).toFixed(1)} km²`)
      .join("; "),
  });
}
function validate(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map;
  for (const name of ecologyScalars) {
    const invalid = map[name].findIndex((value) => !Number.isFinite(value) || value < 0);
    requireThat(
      invalid < 0,
      "ecology_field",
      `Ecology ${name} must remain finite and nonnegative (${context.invocation.join("/")}, cell ${invalid}, value ${map[name][invalid]}).`
    );
  }
  for (const name of ecologyRatios)
    requireThat(
      map[name].every((value) => value <= 1.000001),
      "ecology_cover",
      `Ecology ${name} must remain a fraction.`
    );
  return [];
}
export function ecologyProcesses(input: AtlasGenerationInput): MapProcess[] {
  return ["initialize", "evolve", "respond", "burial", "present"].map((name) => ({
    contract: {
      id: `atlas.ecology-${name}`,
      version: "1",
      parameters: {},
      requires: ecologyRequirements(name),
      produces: ecologyProducts(name),
      invalidates: ["evolve", "respond"].includes(name) ? ["canonry:Runoff"] : [],
      products: [{ id: "atlas:ecology-response", lifetime: "epoch", representation: "history" }],
      workspaceOnly: true,
    },
    behavior: ecologyBehavior(name, input),
    validate,
  }));
}
function ecologyBehavior(name: string, input: AtlasGenerationInput): ProcessBehavior {
  if (name === "initialize")
    return {
      kind: "initialize",
      initialize: (state, context) => initialize(state, ecologyInput(input, context).seed),
    };
  if (["evolve", "respond"].includes(name))
    return {
      kind: "elapsed",
      duration: { kind: "epoch", fraction: 0.5 },
      advance(state, context, years) {
        if (name === "evolve" && !state.physical!.inherited)
          state.physical!.map.MigrationFlux.fill(0);
        advance(state, context, ecologyInput(input, context), years);
      },
    };
  if (name === "burial")
    return {
      kind: "elapsed",
      duration: { kind: "epoch", fraction: 1 },
      advance(state, context, years) {
        evolveBuriedCarbon(state.physical!.map, state.physical!.inherited ? 0 : years);
        present(state, ecologyInput(input, context).seed);
        recordEcology(state, context);
      },
    };
  return {
    kind: "model-pass",
    applyPass(state, context) {
      const bound = ecologyInput(input, context);
      present(state, bound.seed, bound.physical ? undefined : bound, context);
    },
  };
}
function ecologyRequirements(name: string) {
  if (name === "initialize") return ["canonry:workspace", "canonry:Elevation"];
  // Burial consumes the retained response's epoch climate and new coastal
  // deposition, rather than claiming climate was recomputed after coastal work.
  if (name === "burial") return ["canonry:workspace", "atlas:ecology-response"];
  const required = [
    "canonry:workspace",
    "atlas:ecology-initialized",
    "canonry:Temperature",
    "canonry:Moisture",
  ];
  if (["evolve", "respond"].includes(name)) required.push("canonry:FlowRouting");
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
    before = map.BiomeCodes.slice();
  evolveVegetation(
    map,
    years,
    f,
    coverAuthority(state),
    input.seed ^ Math.imul((context.epochIndices[0] ?? 0) + 1, 16777619)
  );
  applyWoodlands(state);
  accumulateOrganicMatter(map, years, f);
  recordTransitions(state, before, context);
}

/** New elapsed human time is distinct from spatial refinement of completed history. */
export function advanceHumanEcology(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
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
      physical: false,
    },
    years,
    true
  );
}
