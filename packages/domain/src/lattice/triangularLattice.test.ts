import { expect, it } from "vitest";
import { triangleArea } from "./triangularLattice";
import { createCenteredLattice, createWorldLattice } from "./worldLattice";
import { content, forEachCell, halo, nodata } from "./lattice";

function checkSymmetry(lattice: ReturnType<typeof createWorldLattice>) {
  let edges = 0;
  forEachCell(lattice, (cell) => {
    for (let edge = 0; edge < 3; edge++) {
      const j = lattice.neighbor(cell, edge);
      if (j < 0) continue;
      edges++;
      expect(lattice.membership(j)).not.toBe(nodata);
      // Neighbours see each other and the step geometry is consistent both ways.
      let back = -1;
      for (let e = 0; e < 3; e++) if (lattice.neighbor(j, e) === cell) back = e;
      expect(back).toBeGreaterThanOrEqual(0);
      expect(lattice.edgeLength(cell, edge)).toBeCloseTo(lattice.edgeLength(j, back), 9);
      expect(lattice.edgeX(cell, edge)).toBeCloseTo(-lattice.edgeX(j, back), 9);
      const dx = lattice.deltaX(lattice.x(j) - lattice.x(cell)),
        dy = lattice.y(j) - lattice.y(cell);
      expect(Math.hypot(dx, dy)).toBeCloseTo(lattice.edgeLength(cell, edge), 9);
    }
  });
  return edges;
}
it("numbers an open world as a raster whose arithmetic adjacency is symmetric", () => {
  const lattice = createWorldLattice([-100_000, -50_000, 100_000, 50_000], 2000, 10_000);
  expect(lattice.contentCount).toBeGreaterThan(1500);
  expect(lattice.count).toBeGreaterThan(lattice.contentCount);
  const edges = checkSymmetry(lattice);
  expect(edges).toBeGreaterThan(lattice.contentCount * 2);
  let boundary = 0,
    haloCells = 0;
  forEachCell(lattice, (cell) => {
    if (lattice.boundary(cell)) boundary++;
    if (lattice.membership(cell) === halo) haloCells++;
    const [u, v, inverted] = lattice.address(cell);
    expect(lattice.addressCell(u, v, inverted)).toBe(cell);
    expect(lattice.cellAt(lattice.x(cell), lattice.y(cell))).toBe(cell);
    expect(lattice.area(cell)).toBeGreaterThan(0);
  });
  expect(boundary).toBeGreaterThan(0);
  expect(haloCells).toBeGreaterThan(0);
  expect(lattice.cellAt(0, 0)).toBeGreaterThanOrEqual(0);
  expect(lattice.membership(lattice.cellAt(0, 0))).toBe(content);
  let contentArea = 0;
  forEachCell(lattice, (cell) => (contentArea += lattice.contentArea(cell)));
  expect(contentArea).toBeCloseTo(200_000 * 100_000, 3);
});
it("wraps a cylindrical world east to west and closes its poles", () => {
  for (const poles of [false, true]) {
    const lattice = createWorldLattice([0, 0, 4_000_000, 2_000_000], 3000, 100_000, {
      wrapX: true,
      closePoles: poles,
    });
    expect(lattice.periodic?.columns).toBeGreaterThan(0);
    expect(lattice.columns).toBe(lattice.periodic!.columns);
    checkSymmetry(lattice);
    let westmost = -1,
      seamEdges = 0;
    forEachCell(lattice, (cell) => {
      if (westmost < 0 || lattice.x(cell) < lattice.x(westmost)) westmost = cell;
      for (let edge = 0; edge < 3; edge++) {
        const j = lattice.neighbor(cell, edge);
        if (j >= 0 && Math.abs(lattice.x(j) - lattice.x(cell)) > lattice.spacing * 3) seamEdges++;
      }
      if (poles) {
        expect(lattice.boundary(cell)).toBe(false);
        for (let edge = 0; edge < 3; edge++)
          if (lattice.neighbor(cell, edge) < 0) expect(lattice.faceLength(cell, edge)).toBe(0);
      }
    });
    expect(seamEdges).toBeGreaterThan(0);
    // A point one chart west of a cell lands on the same cell.
    expect(lattice.cellAt(lattice.x(westmost) - lattice.periodic!.width, lattice.y(westmost))).toBe(
      westmost
    );
    expect(lattice.pointX(lattice.periodic!.width * 0.75)).toBeCloseTo(
      -lattice.periodic!.width * 0.25,
      6
    );
  }
});
it("builds the centered reference lattice with the requested content count", () => {
  const lattice = createCenteredLattice(500, 3);
  expect(lattice.contentCount).toBe(500);
  let haloCells = 0;
  forEachCell(lattice, (cell) => {
    if (lattice.membership(cell) === halo) haloCells++;
  });
  expect(haloCells).toBeGreaterThan(0);
  checkSymmetry(lattice);
  // Every content cell is nearer the centre than every halo cell.
  let farthestContent = 0,
    nearestHalo = Infinity;
  forEachCell(lattice, (cell) => {
    const r = Math.hypot(lattice.x(cell), lattice.y(cell));
    if (lattice.membership(cell) === content) farthestContent = Math.max(farthestContent, r);
    else nearestHalo = Math.min(nearestHalo, r);
  });
  expect(farthestContent).toBeLessThanOrEqual(nearestHalo + 1e-9);
  expect(lattice.area(lattice.cellAt(0, 0))).toBeCloseTo(triangleArea, 9);
});
