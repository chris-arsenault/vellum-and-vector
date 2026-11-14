import type { AdaptiveTopology } from "./adaptiveTopology";
import type { RegularGrid } from "./grids";
/**
 * Bilinear values and class memberships cannot cross inside a uniform quad. Read
 * membership once per station and trace only transitions and the selected outer edge.
 * Include interiors when membership is only a mask for another varying scalar (lakes).
 */
export declare function regularContourSupport(
  grid: RegularGrid,
  inside: (sample: number) => boolean,
  includeInterior?: boolean
): Generator<number, void, unknown>;
/** Reconstruction uses incident-cell gradients; retain the complete three-face stencil. */
export declare function contourSupport(
  topology: AdaptiveTopology,
  members: Iterable<number>
): Generator<number, void, unknown>;
