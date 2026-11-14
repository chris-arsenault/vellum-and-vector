import { TriangularLattice } from "./triangularLattice";
/** Spacing, rows and columns for a world of `samples` cells over the padded extent. */
export declare function worldLatticeShape(
  width: number,
  height: number,
  samples: number,
  padding: number,
  wrap: boolean,
  poles: boolean
): {
  columns: number;
  spacing: number;
  rows: number;
  spacingY: number;
};
export interface WorldLatticeOptions {
  covers?: (x: number, y: number) => boolean;
  area?: number;
  anchor?: [number, number];
  wrapX?: boolean;
  closePoles?: boolean;
  coordinateWidth?: number;
}
/** The world lattice: content inside `bounds` and the footprint, a halo of `padding`. */
export declare function createWorldLattice(
  bounds: [number, number, number, number],
  samples: number,
  padding: number,
  options?: WorldLatticeOptions
): TriangularLattice;
/** A unit-spacing disk of `contentCount` cells nearest the origin, with `padding` more rings;
 * the reference lattice for process tests. */
export declare function createCenteredLattice(
  contentCount: number,
  padding: number
): TriangularLattice;
