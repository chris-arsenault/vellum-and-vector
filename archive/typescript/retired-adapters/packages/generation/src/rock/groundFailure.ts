import type { GroundSectionLayer } from "./groundShares";
import { materialGives, type CompiledMix } from "./modes";

const supportContrast = (response: number, capResponse: number, capDepth: number) =>
  capDepth > 0 && capResponse > 0 ? response / capResponse : 0;

/**
 * A weak exposed foundation can release the finite slab above it. This resolves bulk collapse,
 * not a subcell cavity: the cap leaves with the failing support, and its material must be routed.
 * Heights use native units; run is metres and stable is the ordinary slope's rise/run.
 */
export function supportFailureDepth(
  section: readonly GroundSectionLayer[],
  floor: number,
  direction: readonly [number, number],
  run: number,
  stable: number,
  mix: CompiledMix
) {
  if (section.length === 0 || run <= 0) return 0;
  const surface = section[0].top,
    gradient = MapScale.metres(surface - floor, "native") / run;
  let capResponse = 0,
    capDepth = 0,
    failed = 0;
  for (const layer of section) {
    if (layer.top <= floor) break;
    const depth = layer.top - Math.max(floor, layer.basement ? floor : layer.bottom),
      response = materialGives(mix, layer, layer.medium === "loose", ...direction);
    if (layer.medium === "rock") {
      const contrast = supportContrast(response, capResponse, capDepth);
      // Loading a weaker foundation lowers the stable angle. The finite slab includes the cap;
      // no susceptibility is borrowed to excavate through it with a top-down wear operation.
      if (contrast > 1 && gradient > stable / Math.sqrt(contrast))
        failed = Math.max(failed, surface - layer.top + depth);
    }
    if (layer.medium === "rock") {
      capDepth += depth;
      capResponse += (response - capResponse) * (depth / capDepth);
    }
  }
  return failed;
}
import { MapScale } from "@atlas/domain";
