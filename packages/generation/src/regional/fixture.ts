import {
  canonryConfluencePresets,
  canonryMagicPresets,
  createGrid,
  generateBand,
  gridPosition,
  putChannel,
  rectangle,
  type AtlasFeature,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createRegionalState } from "./capture";
import { measureGrain } from "./character";
import { clearRegionalProducts } from "./extraction/features";
import { regionalSchedule } from "./schedule";
import { channel, type RegionalState } from "./state";

/**
 * Run the fixed schedule on a supplied state as the workflow would: the captured features
 * become the source reader, and regenerated products are cleared before the schedule.
 */
export function runSchedule(state: RegionalState, domains = state.input.domains) {
  freezeSourceFeatures(state);
  clearRegionalProducts(state);
  for (const step of regionalSchedule(domains)) step.run(state);
  return state;
}
/** The supplied features as the capture left them, read-only, like the production source reader. */
export function freezeSourceFeatures(state: RegionalState) {
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
    areaId: state.input.areaId,
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
  const n = state.surface.active.length,
    x = new Float64Array(n),
    y = new Float64Array(n);
  measureGrain(state, state.surface.channels.elevation, x, y);
  let sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const theta = Math.atan2(sy, sx) / 2;
  return { theta: theta < 0 ? theta + Math.PI : theta, coherence: Math.hypot(sx, sy) / n };
}
/** Smallest angle between two axes (radians, 0..π/2). */
export function axisDifference(a: number, b: number) {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/** A coarse supplied parent (5 km samples) and the regional state sampled from it. */
export function regionalFixture(
  height = (x: number, y: number) => 120 + x / 200 - y / 500,
  north = 20000,
  refinementLevel = 1,
  extra: Record<string, [string, (x: number, y: number) => number]> = {}
) {
  const initial = landscape(),
    source = initial.domain,
    footprint = rectangle([0, 0, 40000, north]);
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
  const grid = createGrid("captured", { ...source.scope, resolution: 5000 }, 9, 5);
  const values: Record<string, [string, (x: number, y: number) => number]> = {
    elevation: ["metre", height],
    rock: ["ratio", () => 1],
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
  return { source, input, grid, state: createRegionalState(source, input) };
}
/** Directly supplied present conditions; tests choose the real process they exercise. */
export function regionalEnvironment(refinementLevel = 1) {
  const f = regionalFixture(() => 100, 20000, refinementLevel);
  for (const [name, unit, value] of [
    ["water", "category", 0],
    ["waterDepth", "metre", 0],
    ["slope", "ratio", 0],
    ["sediment", "metre", 0],
    ["catchmentArea", "square-metre", 1e7],
    ["riverOrder", "category", 0],
    ["fracture", "ratio", 0.2],
    ["ice", "ratio", 0],
    ["naturalSurface", "category", 28],
    ["finalSurface", "category", 28],
  ] as const)
    channel(f.state, name, unit, value);
  return f;
}
