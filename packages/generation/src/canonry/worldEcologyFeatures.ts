import { biomes, classMarginInterpolator, spatial, type Band } from "@atlas/domain";
import type { GenerationState } from "../process";
import { landscapeSignificance, worldExtent } from "../worldSignificance";
import { biomeRules, type BiomeSummary } from "./ecologyBiomes";
import { components, publishPlace } from "./geographicRegions";
import { geographicContour, fillSmallHoles, membershipSampler } from "./geographicContours";
import { partitionWorldRegion } from "./worldRegionPartition";
import { regionEvidence } from "./worldRegionEvidence";
import { landArea } from "./regionPartition";
import { projectedValues } from "./atlasSampling";
import { workingArray, releaseWorking } from "./physicalNumerics";
import type { RegionMembers } from "./regionMembers";
import type { PhysicalField } from "./field";
import type { Geometry } from "geojson";

function dryExtent(state: GenerationState, shape: Geometry) {
  let extent = spatial.intersection(shape, state.domain.scope.footprint);
  if (extent && state.surface.ocean) extent = spatial.difference(extent, state.surface.ocean);
  for (const lake of state.surface.lakes ?? [])
    if (extent && spatial.intersects(extent, lake.geometry))
      extent = spatial.difference(extent, lake.geometry);
  return extent;
}

type Summarize = (
  state: GenerationState,
  members: RegionMembers,
  biome: ReturnType<typeof biomeRules>
) => BiomeSummary;
/** Local strength is evidence for an established class, not another color classifier. */
function landscapeStrength(map: PhysicalField, kind: string, i: number) {
  const canopy = map.TreeCover.get(i),
    grass = map.GrassCover.get(i),
    wetland = map.WetlandCover.get(i);
  if (kind === "forest") return Math.min(1, canopy / 0.7);
  if (kind === "wetland") return Math.min(1, wetland / 0.6);
  if (kind === "grassland") return Math.min(1, grass / 0.6);
  if (kind === "barren") return Math.max(0, 1 - canopy - grass - wetland);
  const forcing: Record<string, Band> = {
    ember: map.Quickening,
    thaw: map.Quickening,
    rime: map.Stillness,
    glow: map.Stillness,
    fog: map.FogForcing,
    deepwood: map.Verdure,
    wending: map.Verdure,
    well: map.Verdure,
    barrow: map.Salting,
    pan: map.Salting,
    flat: map.Salting,
  };
  return forcing[kind]?.get(i) ?? 0;
}

/** Broad named landscapes consume the existing local classes and retain their raster edge. */
export function extractWorldEcologicalFeatures(
  state: GenerationState,
  families: Record<string, string>,
  summarize: Summarize
) {
  const work = state.physical!,
    map = work.map,
    biome = biomeRules(state),
    world = worldExtent(state),
    land = landArea(state),
    codes = projectedValues(work, map.BiomeCodes, true),
    field = { ...state.surface, channels: { biome: codes }, overlays: [] },
    labels = workingArray(map, "int32", "world-biome:pieces").fill(-1);
  const family = (code: number) => families[biomes[code]?.name ?? ""];
  try {
    for (const rule of biome.rules) {
      const includes = (i: number) =>
        map.WaterKindCodes.get(i) === 0 && family(map.BiomeCodes.get(i)) === rule.kind;
      const strength = (i: number) => landscapeStrength(map, rule.kind, i);
      const margin = classMarginInterpolator(field, "biome", (code) => family(code) === rule.kind);
      components(state, includes, (members) => {
        const evidence = regionEvidence(map, members, strength, includes),
          judgment = landscapeSignificance(world, rule.kind, evidence);
        if (!judgment.publish) return;
        const pieces = partitionWorldRegion(state, members, land);
        pieces.forEach((piece, index) => piece.forEach((i) => labels.set(i, index)));
        const shares = pieces.map((_, index) =>
          membershipSampler(state, (i) => Number(labels.get(i) === index))
        );
        pieces.forEach((piece, index) => {
          const at = (x: number, y: number) => {
            const other = shares.reduce(
              (largest, sample, j) => (j === index ? largest : Math.max(largest, sample(x, y))),
              0.1
            );
            return Math.min(margin({ x, y, z: 0 }), shares[index](x, y) - other);
          };
          const shape = geographicContour(state, piece, at, 0);
          if (!shape) return;
          const filled = fillSmallHoles(state, shape, 2e9, (i) => map.WaterKindCodes.get(i) !== 0);
          const extent = dryExtent(state, filled);
          if (!extent) return;
          const summary = summarize(state, piece, biome);
          publishPlace(
            state,
            rule.kind,
            rule.name(summary),
            piece,
            "ecology",
            {
              sourceAlgorithm: "atlas-world-geography-1",
              biome: rule.name(summary),
              system: rule.system?.(summary) ?? null,
              worldSignificance: judgment.reason,
              breadth: evidence.breadth,
              coherence: evidence.coherence,
              treeCover: summary.broadleaf + summary.conifer,
              grassCover: summary.grass,
              wetlandCover: summary.wetland,
              temperature: summary.temperature,
              moisture: summary.moisture,
            },
            extent
          );
        });
        for (const i of members) labels.set(i, -1);
      });
    }
  } finally {
    work.grid.release(codes);
    releaseWorking(map, labels, biome.temperature, biome.moisture, biome.wetness);
  }
}
