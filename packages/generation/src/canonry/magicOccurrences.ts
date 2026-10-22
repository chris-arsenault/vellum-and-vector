import { preparedValue, spatial } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { physicalContour } from "./geographicContours";
import { provinceTransport } from "./provinceTransport";

/** Record first arrival as geography at the history producer's prepared-field boundary. */
export function recordMagicOccurrences(state: GenerationState, field: MagicField) {
  const map = state.physical!.map;
  for (const name of ["firstEpoch", "coastalFirstEpoch"] as const) {
    const epoch = field.pendingOccurrences?.[name];
    if (epoch === undefined) continue;
    const channel = name === "firstEpoch" ? "history" : "coastalHistory";
    const entries = ((field.occurrences ??= {})[name] ??= []);
    const read = preparedValue(map.continuous!.support, field[channel], {
      coefficients: field.coefficients?.[channel],
      adaptive: field.adaptive?.[channel],
    });
    const support = read.positiveSupport();
    // First arrival means positive history, with no artificial intensity cutoff.
    let extent = field[channel].some((value) => value > 0)
      ? support
        ? physicalContour(state, support, support.enclose, support.segment)
        : physicalContour(state, read, read.enclose, read.segment)
      : null;
    if (extent && entries.length)
      extent = spatial.difference(
        extent,
        spatial.unionAll(entries.map((entry) => entry.footprint))
      );
    if (extent) {
      const existing = entries.find((entry) => entry.epoch === epoch);
      if (existing) existing.footprint = spatial.unionAll([existing.footprint, extent]);
      else entries.push({ epoch, footprint: extent });
    }
    delete field.pendingOccurrences![name];
  }
}

/** History follows the producer's province motion and material collision ownership. */
export function advectMagicOccurrences(state: GenerationState, field: MagicField) {
  if (!field.occurrences || !Object.values(field.occurrences).some((entries) => entries.length))
    return;
  const map = state.physical!.map,
    distance = map.LastPlateDriftStep;
  if (distance <= 0) return;
  const prepared = provinceTransport(map, distance);
  for (const name of ["firstEpoch", "coastalFirstEpoch"] as const) {
    const entries = field.occurrences[name];
    if (!entries) continue;
    field.occurrences[name] = entries.flatMap((entry) => {
      const footprint = prepared.transport(entry.footprint);
      return footprint ? [{ epoch: entry.epoch, footprint }] : [];
    });
  }
}
