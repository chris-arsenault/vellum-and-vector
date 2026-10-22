import { requireThat } from "./errors";
import type { FieldSamples } from "./grids";
import type { Geometry } from "geojson";
import type { SpatialScope } from "./schemas";
import { rectangle, spatial } from "./spatial";
import {
  adaptiveCell,
  adaptiveGeometry,
  adaptiveLeafAt,
  type AdaptiveTopology,
} from "./adaptiveTopology";
import { preparedChannel } from "./preparedField";

/** Generated fields retain adaptive physical samples instead of a mandatory uniform raster. */
export interface AdaptiveField extends FieldSamples {
  mesh?: never;
  width?: never;
  height?: never;
  topology: AdaptiveTopology;
}
export function adaptiveMeasures(topology: AdaptiveTopology, footprint: Geometry) {
  const extent = spatial.bounds(footprint);
  const rectangular = spatial.covers(footprint, rectangle(extent));
  const measure = spatial.intersectionArea(footprint);
  return Float64Array.from(topology.leaves, (_, i) => {
    const box = adaptiveCell(topology, i);
    if (rectangular)
      return (
        Math.max(0, Math.min(box[2], extent[2]) - Math.max(box[0], extent[0])) *
        Math.max(0, Math.min(box[3], extent[3]) - Math.max(box[1], extent[1]))
      );
    return measure(rectangle(box));
  });
}
export function createAdaptiveField(
  id: string,
  scope: SpatialScope,
  topology: AdaptiveTopology
): AdaptiveField {
  requireThat(
    spatial.covers(rectangle(topology.bounds), scope.footprint),
    "adaptive_extent",
    "Adaptive topology must cover its field footprint."
  );
  const geometry = adaptiveGeometry(topology);
  const measures = adaptiveMeasures(topology, scope.footprint);
  return {
    id,
    scope: {
      ...scope,
      resolution: geometry.width.reduce(
        (maximum, width, i) =>
          measures[i] > 0 ? Math.max(maximum, width, geometry.height[i]) : maximum,
        0
      ),
    },
    bounds: spatial.bounds(scope.footprint),
    topology,
    active: Uint8Array.from(measures, (area) => Number(area > 0)),
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
  const at = categorical ? null : preparedChannel(field, channel);
  return (p: { x: number; y: number }): number => {
    if (!covers({ x: p.x, y: p.y, z: 0 })) return NaN;
    const i = adaptiveLeafAt(field.topology, p.x, p.y);
    if (i < 0 || !field.active[i]) return NaN;
    return at ? at({ ...p, z: 0 }) : values[i];
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
