import { requireThat } from "./errors";
import type { FieldSamples } from "./grids";
import type { Geometry } from "geojson";
import type { SpatialScope } from "./schemas";
import { rectangle, spatial } from "./spatial";
import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import { adaptivePointSampler } from "./adaptivePoint";
import type { BlockCache } from "./lattice/blockCache";
import type { Coverage } from "./lattice/coverage";
import { foldSamples, generateBand, sampleCoverage } from "./lattice/bandValues";

/** Generated fields retain adaptive physical samples instead of a mandatory uniform raster. */
export interface AdaptiveField extends FieldSamples {
  width?: never;
  height?: never;
  topology: AdaptiveTopology;
}
/** Area of each leaf inside the footprint, as a band in `coverage`. */
export function adaptiveMeasures(
  topology: AdaptiveTopology,
  footprint: Geometry,
  coverage: Coverage = topology.coverage
) {
  const extent = spatial.bounds(footprint);
  const rectangular = spatial.covers(footprint, rectangle(extent));
  const measure = spatial.intersectionArea(footprint);
  return generateBand(
    coverage,
    "float64",
    "adaptive:measures",
    (i) => {
      const box = adaptiveCell(topology, i);
      if (rectangular)
        return (
          Math.max(0, Math.min(box[2], extent[2]) - Math.max(box[0], extent[0])) *
          Math.max(0, Math.min(box[3], extent[3]) - Math.max(box[1], extent[1]))
        );
      return measure(rectangle(box));
    },
    topology.leaves.length
  );
}
export function createAdaptiveField(
  id: string,
  scope: SpatialScope,
  topology: AdaptiveTopology,
  cache: BlockCache = topology.coverage.cache
): AdaptiveField {
  requireThat(
    spatial.covers(rectangle(topology.bounds), scope.footprint),
    "adaptive_extent",
    "Adaptive topology must cover its field footprint."
  );
  const coverage = sampleCoverage(topology.leaves.length, cache),
    measures = adaptiveMeasures(topology, scope.footprint, coverage);
  return {
    id,
    scope: {
      ...scope,
      resolution: foldSamples(
        measures,
        (maximum, area, i) => {
          if (area <= 0) return maximum;
          const box = adaptiveCell(topology, i);
          return Math.max(maximum, box[2] - box[0], box[3] - box[1]);
        },
        0
      ),
    },
    bounds: spatial.bounds(scope.footprint),
    topology,
    coverage,
    active: generateBand(coverage, "uint8", `${id}:active`, (i) => Number(measures.get(i) > 0)),
    measures,
    channels: {},
    units: {},
  };
}
export function adaptiveFieldSampler(field: AdaptiveField, channel: string, discrete = false) {
  const values = field.channels[channel];
  requireThat(
    values?.length === field.topology.leaves.length,
    "missing_channel",
    `Adaptive channel ${channel} requires one value per leaf.`
  );
  const covers = spatial.pointCoverage(field.scope.footprint);
  const categorical =
    discrete ||
    ["category", "cell-index"].includes(field.units[channel]) ||
    ["category", "extensive"].includes(field.quantities?.[channel] ?? "");
  const reconstructed = categorical ? null : adaptivePointSampler(field.topology, values);
  return (p: { x: number; y: number }): number => {
    if (!covers({ x: p.x, y: p.y, z: 0 })) return NaN;
    const i = adaptiveLeafAt(field.topology, p.x, p.y);
    if (i < 0 || !field.active.get(i)) return NaN;
    return reconstructed ? reconstructed(p.x, p.y) : values.get(i);
  };
}
export function adaptiveIntegral(field: AdaptiveField, channel: string) {
  requireThat(field.channels[channel], "missing_channel", `No ${channel} channel in this field.`);
  const extensive = field.quantities?.[channel] === "extensive";
  return foldSamples(
    field.channels[channel],
    (sum, value, i) =>
      sum + (extensive ? (field.active.get(i) ? value : 0) : value * field.measures.get(i)),
    0
  );
}
