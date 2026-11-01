import {
  canonryConfluencePresets,
  canonryMagicPresets,
  createGrid,
  generateBand,
  gridPosition,
  putChannel,
  rectangle,
  requireThat,
  type AtlasFeature,
  type DomainSnapshot,
  type Landmark,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import { landscape } from "../mapFixtures";
import type { GenerationState, MapProcessContext, ProcessInvocation } from "../process";
import { executeProcessBehavior } from "../processTraits";
import { regionalInitialState } from "./capture";
import { measureGrain } from "./character";
import { prepareMagic } from "./magic/index";
import type { RegionalState } from "./state";
import { prepareRegionalRefinement, regionalSequence } from "./workflow";

type Prepared = ReturnType<typeof prepareRegionalRefinement>;
const prepared = new WeakMap<
  GenerationState,
  { source: DomainSnapshot; input: AtlasGenerationInput }
>();

/** A process context with the run's bindings and no runner: enough for every regional process. */
function stubContext(run: Prepared, invocation: ProcessInvocation): MapProcessContext {
  return {
    scope: structuredClone(run.source.scope),
    invocation: [invocation.id],
    parameters: {},
    inputs: structuredClone(run.input.configuration!.inputs ?? {}),
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    random: () => 0,
    cancelled: () => false,
    progress() {},
  };
}
function runInvocations(
  state: GenerationState,
  run: Prepared,
  include: (invocation: ProcessInvocation) => boolean
) {
  for (const invocation of regionalSequence(run.input)) {
    if (invocation.kind !== "process" || !include(invocation)) continue;
    const process = run.registry.get(invocation.process, invocation.version),
      outcome = executeProcessBehavior(process, state, stubContext(run, invocation));
    requireThat(
      !(outcome instanceof Promise),
      "fixture_process",
      `${invocation.id} is synchronous.`
    );
  }
}
const preparation = new Set(["canonry.initialize", "refinement.begin"]);

/**
 * The initial state of a refinement with its physical workspace built and the regional work
 * attached, as the runner leaves it after `canonry.initialize` and `refinement.begin`.
 */
export function regionalWorkingState(
  source: DomainSnapshot,
  input: AtlasGenerationInput
): RegionalState {
  const run = prepareRegionalRefinement(source, input),
    state = regionalInitialState(run.source, run.input);
  runInvocations(state, run, (invocation) => preparation.has(invocation.process));
  prepared.set(state, { source, input });
  return state as RegionalState;
}

/**
 * Run the schedule, the world's projection and extraction and the regional identity and
 * place steps on a working state, through the same processes the runner executes. The
 * supplied features become the source reader, and regenerated products are cleared before
 * the schedule as in production.
 */
export function runSchedule(state: RegionalState, domains = state.regional.input.domains) {
  freezeSourceFeatures(state);
  const kept = prepared.get(state)!,
    run = prepareRegionalRefinement(kept.source, { ...kept.input, domains });
  state.regional.input.domains = domains;
  if (!domains.includes("magic") && state.physical.magic?.fields.length) prepareMagic(state);
  runInvocations(state, run, (invocation) => !preparation.has(invocation.process));
  return state;
}
/** The supplied features as the capture left them, read-only, like the production source reader. */
export function freezeSourceFeatures(state: GenerationState) {
  if (state.sourceFeatures) return state.sourceFeatures;
  const frozen = new Map(
    Object.values(state.domain.world.features).map((f) => [f.id, structuredClone(f)])
  );
  state.sourceFeatures = {
    get: (id) => frozen.get(id),
    *values(selection) {
      for (const f of frozen.values())
        if (!selection?.areaId || f.areaId === selection.areaId) yield f;
    },
  };
  return state.sourceFeatures;
}
/** Enable the named preset systems (all when omitted) with the preset meetings. */
export function enableMagic(state: RegionalState, ids?: string[]) {
  state.domain.world.magicSystems = canonryMagicPresets().map((s) => ({
    ...s,
    enabled: !ids || ids.includes(s.id),
  }));
  state.domain.world.confluences = canonryConfluencePresets();
  if (!state.regional.input.domains.includes("magic")) state.regional.input.domains.push("magic");
  prepareMagic(state);
  return state.domain.world.magicSystems;
}
/** A captured feature on this map, as the capture path would leave it. */
export function suppliedFeature(
  state: RegionalState,
  id: string,
  kind: string,
  layerId: string,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown> = {},
  name = id
): AtlasFeature {
  const feature: AtlasFeature = {
    id,
    placeId: id,
    areaId: state.regional.input.areaId,
    layerId,
    kind,
    name,
    geometry,
    attributes: { nameStatus: "proper", ...attributes },
    relations: [],
    causes: [],
    detail: {},
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    generationDomain: state.domain.world.layers[layerId]?.generator ?? null,
  };
  state.domain.world.features[id] = feature;
  return feature;
}
/** The mean axis (radians, 0..π) and coherence of the realized relief's organization. */
export function dominantAxis(state: RegionalState) {
  const map = state.physical.map,
    n = map.mesh.count,
    x = new Float64Array(n),
    y = new Float64Array(n);
  measureGrain(state, (i) => map.Elevation.get(i) / 1024, x, y);
  let sx = 0,
    sy = 0,
    cells = 0;
  for (let i = 0; i < n; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    sx += x[i];
    sy += y[i];
    cells++;
  }
  const theta = Math.atan2(sy, sx) / 2;
  return { theta: theta < 0 ? theta + Math.PI : theta, coherence: Math.hypot(sx, sy) / cells };
}
/** Smallest angle between two axes (radians, 0..π/2). */
export function axisDifference(a: number, b: number) {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/** A coarse supplied parent (5 km samples) and the regional working state built from it. */
/** The fixture world's child map over the frame, with the parent's captured landmark records. */
function supplyChildArea(
  source: DomainSnapshot,
  footprint: ReturnType<typeof rectangle>,
  refinementLevel: number,
  landmarks: Landmark[]
) {
  source.world.landmarks = [...(source.world.landmarks ?? []), ...landmarks];
  source.world.id = "df8d14c5-4f19-4f11-aa7c-fba42fbde872";
  source.world.areas.parent = { ...source.world.areas.area, id: "parent", footprint };
  source.world.areas.area = {
    ...source.world.areas.area,
    parentId: "parent",
    footprint,
    profile: "region",
    map: { sourceAreaId: "parent", sourceRevision: 1, refinementLevel },
  };
  source.world.reference.domain = footprint;
  source.scope.footprint = footprint;
  // A refinement reads a completed world; the fixture world has had one epoch.
  source.world.epochs = [
    { id: "Present", tectonics: 1, hydrology: 1, ice: 0, coasts: 1, temperature: 15, seaLevel: 0 },
  ];
}
export function regionalFixture(
  height = (x: number, y: number) => 120 + x / 200 - y / 500,
  north = 20000,
  refinementLevel = 1,
  extra: Record<string, [string, (x: number, y: number) => number]> = {},
  landmarks: Landmark[] = []
) {
  const initial = landscape(),
    source = initial.domain,
    footprint = rectangle([0, 0, 40000, north]);
  supplyChildArea(source, footprint, refinementLevel, landmarks);
  // The parent is captured over the frame and its padding, as a completed world supplies it:
  // the exterior continues the supplied country instead of clamping to the frame edge.
  const padding = 100_000,
    spacing = [5000, north / 4],
    grid = createGrid(
      "captured",
      { ...source.scope, resolution: 5000 },
      (40000 + 2 * padding) / spacing[0] + 1,
      (north + 2 * padding) / spacing[1] + 1,
      [-padding, -padding, 40000 + padding, north + padding]
    );
  const values: Record<string, [string, (x: number, y: number) => number]> = {
    elevation: ["metre", height],
    rock: ["ratio", () => 0.25],
    temperature: ["celsius", () => 16],
    moisture: ["ratio", () => 0.65],
    rainfall: ["metre/year", () => 1.2],
    runoff: ["metre/year", () => 0.6],
    soilDepth: ["metre", () => 1],
    treeCover: ["ratio", () => 0.4],
    ...extra,
  };
  for (const [name, [unit, value]] of Object.entries(values))
    putChannel(
      grid,
      name,
      unit,
      generateBand(grid.coverage, "float64", name, (i) => {
        // representation-exempt: the supplied parent is a world grid; the test values are sampled at its own samples.
        const p = gridPosition(grid, i);
        return value(p.x, p.y);
      }),
      unit === "category" ? "category" : "intensive"
    );
  source.numerical = { captured: grid };
  source.world.fields = [
    {
      id: "captured",
      areaId: "area",
      layerId: "elevation",
      algorithm: "supplied",
      input: true,
      source: { kind: "operation", id: "supplied" },
      channels: Object.keys(values),
      samples: grid.active.length,
    },
  ];
  const input = {
    areaId: "area",
    quality: "standard",
    seed: 73,
    domains: ["physical", "magic", "built"],
  };
  return { source, input, grid, state: regionalWorkingState(source, input) };
}
/** Directly supplied present conditions; tests choose the real process they exercise. */
export function regionalEnvironment(refinementLevel = 1) {
  const f = regionalFixture(() => 100, 20000, refinementLevel),
    map = f.state.physical.map;
  map.WaterKindCodes.fill(0);
  map.WaterDepths.fill(0);
  map.Slope.fill(0);
  map.SedimentThickness.fill(0);
  map.CatchmentArea.fill(1e7);
  map.RiverOrders.fill(0);
  map.FractureConductance.fill(200);
  map.IceThickness.fill(0);
  return f;
}
