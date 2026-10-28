import { requireThat } from "../errors";
import { content, halo, nodata, type PeriodicFrame } from "./lattice";
import { TriangularLattice, triangleArea, type TriangularFrame } from "./triangularLattice";

const rootThree = Math.sqrt(3);

/** Spacing, rows and columns for a world of `samples` cells over the padded extent. */
export function worldLatticeShape(
  width: number,
  height: number,
  samples: number,
  padding: number,
  wrap: boolean,
  poles: boolean
) {
  const desired = Math.sqrt(
    ((width + 2 * padding) * (height + 2 * padding)) / (samples * triangleArea)
  );
  const columns = Math.max(1, Math.round(width / (3 * desired)));
  const spacing = wrap ? width / (3 * columns) : desired;
  const rows = Math.max(1, Math.round(height / (rootThree * spacing)));
  return { columns, spacing, rows, spacingY: poles ? height / (rootThree * rows) : spacing };
}
export interface WorldLatticeOptions {
  covers?: (x: number, y: number) => boolean;
  area?: number;
  anchor?: [number, number];
  wrapX?: boolean;
  closePoles?: boolean;
}
function worldFrame(
  bounds: [number, number, number, number],
  samples: number,
  padding: number,
  wrapX: boolean,
  closePoles: boolean
) {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1],
    shape = worldLatticeShape(width, height, samples, padding, wrapX, closePoles),
    workPadding = closePoles ? 0 : padding;
  const frame: TriangularFrame = {
    width: width + (wrapX ? 0 : 2 * workPadding),
    height: height + 2 * workPadding,
    spacing: shape.spacing,
    spacingY: shape.spacingY,
    offset: [0, 0],
  };
  const periodic: PeriodicFrame | undefined = wrapX
    ? {
        width,
        columns: shape.columns,
        ...(closePoles ? { poles: { rows: shape.rows, spacingY: shape.spacingY } } : {}),
      }
    : undefined;
  return { frame, periodic };
}
/** The world lattice: content inside `bounds` and the footprint, a halo of `padding`. */
export function createWorldLattice(
  bounds: [number, number, number, number],
  samples: number,
  padding: number,
  options: WorldLatticeOptions = {}
): TriangularLattice {
  const wrapX = options.wrapX ?? false,
    closePoles = options.closePoles ?? false,
    { frame, periodic } = worldFrame(bounds, samples, padding, wrapX, closePoles);
  const build = () =>
    new TriangularLattice({
      bounds,
      frame,
      covers: options.covers ?? (() => true),
      area: options.area ?? (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]),
      padding,
      periodic,
      openBoundary: !closePoles,
    });
  let lattice = build();
  if (!lattice.contentCount) {
    // Shift the frame so the footprint's interior point lands on a cell.
    const anchor = options.anchor ?? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    frame.offset = [
      anchor[0] - (bounds[0] + bounds[2]) / 2 - frame.spacing,
      anchor[1] - (bounds[1] + bounds[3]) / 2,
    ];
    lattice = build();
  }
  requireThat(
    lattice.contentCount > 0,
    "lattice_empty",
    "World sampling needs at least one cell inside its footprint."
  );
  return lattice;
}
/** A unit-spacing disk of `contentCount` cells nearest the origin, with `padding` more rings;
 * the reference lattice for process tests. */
export function createCenteredLattice(contentCount: number, padding: number): TriangularLattice {
  const radius = Math.sqrt((contentCount * triangleArea) / Math.PI),
    workRadius = radius + padding,
    count = Math.max(contentCount, Math.ceil((Math.PI * workRadius ** 2) / triangleArea)),
    extent = 2 * (Math.sqrt((count * triangleArea) / Math.PI) + 4);
  const frame: TriangularFrame = {
    width: 2 * extent,
    height: 2 * extent,
    spacing: 1,
    spacingY: 1,
    offset: [0, 0],
  };
  // The content disk is the nearest `contentCount` sites; the halo the next ring of sites.
  const probe = new TriangularLattice({
    bounds: [-extent, -extent, extent, extent],
    frame,
    covers: () => true,
    area: 1,
    padding,
    openBoundary: false,
  });
  const order = Int32Array.from({ length: probe.count }, (_, i) => i).filter(
    (cell) => probe.membership(cell) !== nodata
  );
  const distance = Float64Array.from(order, (cell) => probe.x(cell) ** 2 + probe.y(cell) ** 2);
  const ranked = Array.from(order.keys()).sort((p, q) => {
    const byDistance = distance[p] - distance[q];
    if (byDistance) return byDistance;
    const [ua, va, ia] = probe.address(order[p]),
      [ub, vb, ib] = probe.address(order[q]);
    return ua - ub || va - vb || Number(ia) - Number(ib);
  });
  const chosen = new Uint8Array(probe.count);
  for (let n = 0; n < Math.min(count, ranked.length); n++)
    chosen[order[ranked[n]]] = n < contentCount ? content : halo;
  // The final lattice shares the probe's frame, so its cell ids are the probe's.
  return new TriangularLattice({
    bounds: [-extent, -extent, extent, extent],
    frame,
    covers: () => true,
    area: contentCount * triangleArea,
    padding,
    openBoundary: false,
    membership: (cell) => chosen[cell],
  });
}
