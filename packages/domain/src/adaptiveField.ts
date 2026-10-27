import { requireThat } from "./errors";
import type { FieldSamples } from "./grids";
import type { Geometry } from "geojson";
import type { SpatialScope } from "./schemas";
import { rectangle, spatial } from "./spatial";
import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import { adaptivePointSampler } from "./adaptivePoint";
import type { NumericalAllocator } from "./numericalVector";
import { generateNumerical } from "./numericalAllocation";

/** Generated fields retain adaptive physical samples instead of a mandatory uniform raster. */
export interface AdaptiveField extends FieldSamples {
  width?: never;
  height?: never;
  topology: AdaptiveTopology;
}
export function adaptiveMeasures(
  topology: AdaptiveTopology,
  footprint: Geometry,
  numerical?: NumericalAllocator
) {
  const extent = spatial.bounds(footprint);
  const rectangular = spatial.covers(footprint, rectangle(extent));
  const measure = spatial.intersectionArea(footprint);
  return generateNumerical(
    { type: "float64", length: topology.leaves.length, lifetime: "run", name: "adaptive:measures" },
    (i) => {
      const box = adaptiveCell(topology, i);
      if (rectangular)
        return (
          Math.max(0, Math.min(box[2], extent[2]) - Math.max(box[0], extent[0])) *
          Math.max(0, Math.min(box[3], extent[3]) - Math.max(box[1], extent[1]))
        );
      return measure(rectangle(box));
    },
    numerical
  );
}
export function createAdaptiveField(
  id: string,
  scope: SpatialScope,
  topology: AdaptiveTopology,
  numerical?: NumericalAllocator
): AdaptiveField {
  requireThat(
    spatial.covers(rectangle(topology.bounds), scope.footprint),
    "adaptive_extent",
    "Adaptive topology must cover its field footprint."
  );
  const measures = adaptiveMeasures(topology, scope.footprint, numerical);
  return {
    id,
    scope: {
      ...scope,
      resolution: measures.reduce((maximum, area, i) => {
        if (area <= 0) return maximum;
        const box = adaptiveCell(topology, i);
        return Math.max(maximum, box[2] - box[0], box[3] - box[1]);
      }, 0),
    },
    bounds: spatial.bounds(scope.footprint),
    topology,
    active: generateNumerical(
      { type: "uint8", length: measures.length, lifetime: "run", name: `${id}:active` },
      (i) => Number(measures[i] > 0),
      numerical
    ),
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
    if (i < 0 || !field.active[i]) return NaN;
    return reconstructed ? reconstructed(p.x, p.y) : values[i];
  };
}
export function adaptiveIntegral(field: AdaptiveField, channel: string) {
  requireThat(field.channels[channel], "missing_channel", `No ${channel} channel in this field.`);
  return field.channels[channel].reduce(
    (sum, value, i) =>
      sum +
      (field.quantities?.[channel] === "extensive"
        ? field.active[i]
          ? value
          : 0
        : value * field.measures[i]),
    0
  );
}
