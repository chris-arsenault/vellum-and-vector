import type { Position } from "./model";
import { smoothSampleInterpolator, type ReconstructedField } from "./smoothSamples";

export function scalarReconstruction(
  source: ReconstructedField,
  channel: string,
  discrete: boolean
) {
  if (!source.channels[channel] || discrete) return null;
  if (channel === "maximumGroundedIceFlux" && source.channels.maximumIceFlux)
    return groundedFluxInterpolator(source);
  const at = smoothSampleInterpolator(source.support, source.channels[channel]);
  return Object.assign((p: Position) => at(p.x, p.y), { bounds: at.bounds });
}
/** Grounded history is a bounded subset of total history, including between samples. */
function groundedFluxInterpolator(source: ReconstructedField) {
  const total = smoothSampleInterpolator(source.support, source.channels.maximumIceFlux);
  const grounded = smoothSampleInterpolator(source.support, source.channels.maximumGroundedIceFlux);
  return Object.assign((p: Position) => Math.min(grounded(p.x, p.y), total(p.x, p.y)), {
    bounds: (box: Parameters<typeof total.bounds>[0], candidates: number[]): [number, number] => {
      const a = grounded.bounds(box, candidates),
        b = total.bounds(box, candidates);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    },
  });
}
