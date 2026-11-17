import type { RealScale } from "@atlas/map";
import { formatDistance } from "./realScale";

/**
 * The refinement dialog's words. The opened child is a real-scale map when its own
 * description says so (ADR 0016); otherwise it is a region.
 */
export function wording(real: RealScale | undefined, size: { width: number; height: number }) {
  return real
    ? {
        title: "Open a real-scale map",
        summary: realScaleSummary(real, size),
        name: "Map name",
        generate: "Generate map",
      }
    : {
        title: "Refine region",
        summary: `${size.width / 1000} × ${size.height / 1000} km`,
        name: "Region name",
        generate: "Generate region",
      };
}
function realScaleSummary(real: RealScale, size: { width: number; height: number }) {
  const kind = real.kind === "ground" ? "ground map" : "building-floors map";
  const across = formatDistance(size.width, "metres");
  const down = formatDistance(size.height, "metres");
  return `A ${real.acrossFlats} m (${real.feet} ft) hex ${kind}, ${across} × ${down}`;
}
