import {
  cloneSnapshot,
  createGrid,
  fieldInterpolator,
  gridPosition,
  putChannel,
  rectangle,
  spatial,
  semanticId,
  requireThat,
  adaptivePointLocator,
  type DomainSnapshot,
  type BlockCache,
  type Grid,
  canonicalPosition,
  regionalScale,
  mapRefinementLevel,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "../atlasWorkflow";
import type { RefinementState } from "./state";
import { compactBounds, refinementFootprint, refinementFrame } from "./frame";

const presentChannels = new Set([
  "elevation",
  "rock",
  "fracture",
  "geothermal",
  "margin",
  "glacialErosion",
  "ice",
  "seaDatum",
  "seaLevel",
  "temperature",
  "moisture",
  "rainfall",
  "snowfall",
  "runoff",
  "windEast",
  "windNorth",
  "soilDepth",
  "treeCover",
  "grassCover",
  "wetlandCover",
  "soilCarbon",
  "mineralNutrients",
  "heat",
  "storedHeat",
  "quickening",
  "stillness",
  "fog",
  "verdure",
  "salting",
  "warding",
  "tearing",
  "water",
  "waterDepth",
  "waterLevel",
  "flow",
  "catchmentArea",
  "riverOrder",
  "slope",
  "sediment",
  "erosion",
  "biome",
  "naturalSurface",
  "finalSurface",
  "secondSurface",
  "physicalMaterial",
  "naturalTemperature",
]);
export function refinementChannel(name: string) {
  const material =
    name.startsWith("magic:") &&
    (/:(intensity|source|stored|retained|wake|rogue|sealed|wild|subsided|uplifted)$/.test(name) ||
      name.includes(":stock:"));
  return presentChannels.has(name) || material;
}
export function isRegionalRefinement(source: DomainSnapshot, areaId: string) {
  return !!source.world.areas[areaId]?.map;
}
/** Only pinned inputs on this map; neither live ancestors nor sibling products are candidates. */
export function refinementInputFields(source: DomainSnapshot, areaId: string, physical = true) {
  return source.world.fields.filter((f) => f.areaId === areaId && (!physical || f.input));
}
export function refinementReads(source: DomainSnapshot, areaId: string, physical = true) {
  return refinementInputFields(source, areaId, physical)
    .map((field) => ({
      fieldId: field.id,
      names: (field.channels ?? []).filter(refinementChannel),
    }))
    .filter((field) => field.names.length);
}
function sampleSpan(grid: Grid) {
  if (grid.scope.resolution) return grid.scope.resolution;
  const [w, s, e, n] = grid.bounds;
  return grid.topology
    ? Math.sqrt(((e - w) * (n - s)) / grid.active.length)
    : Math.max((e - w) / (grid.width - 1), (n - s) / (grid.height - 1));
}
export function refinementResolution(
  source: DomainSnapshot,
  input: Pick<AtlasGenerationInput, "areaId" | "quality">
) {
  const base = regionalScale(
    Math.max(1, mapRefinementLevel(source.world.areas, input.areaId)),
    input.quality
  );
  const bounds = compactBounds(source, refinementFootprint(source, input.areaId));
  const cellSpan = Math.min(
    base.cellSpan,
    Math.min(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 8
  );
  const cells =
    (Math.ceil((bounds[2] - bounds[0]) / cellSpan) + 1) *
    (Math.ceil((bounds[3] - bounds[1]) / cellSpan) + 1);
  return { cellSpan, cellArea: cellSpan ** 2, cellAreaKm2: cellSpan ** 2 / 1e6, cells };
}
export function createRefinementState(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  cache?: BlockCache
): RefinementState {
  const domain = cloneSnapshot(source),
    area = domain.world.areas[input.areaId],
    { cellSpan } = refinementResolution(source, input),
    physical = input.domains.includes("physical"),
    inputs = sampledChannels(source, area.id, physical);
  const parent = inputs.get("elevation");
  requireThat(parent, "regional_parent", "Capture terrain on this map before refining it.");
  const { bounds, footprint } = refinementFrame(source, area.id, physical);
  const current = currentLayout(source, parent, physical, cellSpan);
  const surface = createGrid(
    semanticId(domain.world.id, "regional-surface", `${area.id}:${input.seed}`),
    { ...source.scope, areaId: area.id, footprint: rectangle(bounds), resolution: cellSpan },
    current?.width ?? Math.ceil((bounds[2] - bounds[0]) / cellSpan) + 1,
    current?.height ?? Math.ceil((bounds[3] - bounds[1]) / cellSpan) + 1,
    bounds,
    cache
  );
  surface.scope.footprint = footprint;
  area.footprint = footprint;
  domain.scope = { ...surface.scope };
  const worldBounds =
    domain.world.reference.boundaryMode === "cylinder"
      ? spatial.bounds(domain.world.reference.domain)
      : undefined;
  if (worldBounds) surface.periodicWidth = worldBounds[2] - worldBounds[0];
  const locate = adaptivePointLocator(),
    evaluators = [...inputs].map(([name, grid]) => {
      const values = surface.coverage.scratch("float64", name, surface.active.length);
      putChannel(surface, name, grid.units[name], values, grid.quantities?.[name]);
      const at = fieldInterpolator(grid, name, grid.units[name] === "category", locate);
      const measure =
        grid.quantities?.[name] === "extensive"
          ? fieldInterpolator(
              { ...grid, channels: { measure: grid.measures }, units: { measure: "square-metre" } },
              "measure",
              true,
              locate
            )
          : null;
      return { at, values, measure };
    });
  // All channels share each position lookup. No intermediate physical mesh or second projection.
  for (let i = 0; i < surface.active.length; i++) {
    const p = canonicalPosition(domain.world.reference, gridPosition(surface, i), worldBounds);
    for (const { at, values, measure } of evaluators)
      values.set(i, at(p) * (measure ? surface.measures.get(i) / Math.max(1, measure(p)) : 1));
  }
  return {
    domain,
    surface,
    input: {
      areaId: input.areaId,
      quality: input.quality,
      seed: input.seed,
      domains: input.domains,
    },
    parentSpan: sampleSpan(parent),
    inheritedHeight: surface.coverage.copyBand(surface.channels.elevation),
  };
}

function sampledChannels(source: DomainSnapshot, areaId: string, physical: boolean) {
  const fields = refinementInputFields(source, areaId, physical)
      .filter((f) => source.numerical[f.id])
      .sort(
        (a, b) =>
          Number(!!b.input) - Number(!!a.input) ||
          sampleSpan(source.numerical[b.id]) - sampleSpan(source.numerical[a.id])
      )
      .map((f) => source.numerical[f.id]),
    inputs = new Map<string, Grid>();
  for (const grid of fields)
    for (const name of Object.keys(grid.channels))
      if (refinementChannel(name)) inputs.set(name, grid);
  return inputs;
}
function currentLayout(source: DomainSnapshot, parent: Grid, physical: boolean, span: number) {
  if (physical || parent.topology || span < sampleSpan(parent)) return null;
  return source.world.fields.some((f) => !f.input && source.numerical[f.id] === parent)
    ? parent
    : null;
}
