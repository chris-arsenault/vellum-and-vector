import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  adaptiveCell,
  createAdaptiveTopology,
  refineAdaptiveWhere,
  prepareAdaptiveTransfer,
  rectangle,
  generateNumerical,
} from "@atlas/domain";
import { adaptivePhysicalMesh } from "../../generation/src/canonry/adaptiveMesh";
import { edgeLeadingTo } from "../../generation/src/canonry/mesh";
import { PagedArena } from "./pagedArena";
import { physicalFace } from "../../generation/src/canonry/physicalMetric";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "atlas-adaptive-")),
    fd = openSync(join(directory, "work.bin"), "w+"),
    arena = new PagedArena(
      {
        read: (bytes, offset) => readSync(fd, bytes, 0, bytes.byteLength, offset),
        write: (bytes, offset) => writeSync(fd, bytes, 0, bytes.byteLength, offset),
        flush() {},
        close: () => closeSync(fd),
      },
      65_536,
      128
    );
  return {
    arena,
    close() {
      arena.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
it("refines on disk and transfers all material across unchanged, split and coarsened cells", () => {
  const f = fixture();
  try {
    const bounds: [number, number, number, number] = [0, 0, 1024, 1024],
      source = createAdaptiveTopology(
        bounds,
        { maximumSize: 64, minimumSize: 32, refine: (box) => box[0] < 256 },
        f.arena
      ),
      target = refineAdaptiveWhere(source, 16, (box) => box[0] > 700 && box[1] < 400, f.arena),
      sourceValues = generateNumerical(
        { type: "float64", length: source.leaves.length, lifetime: "run", name: "test:material" },
        (i) => {
          const box = adaptiveCell(source, i);
          return (box[2] - box[0]) * (box[3] - box[1]) * (1 + (box[0] + box[2]) / 2048);
        },
        f.arena
      ),
      transferred = prepareAdaptiveTransfer(source, target, f.arena)(sourceValues, "extensive");
    expect(transferred.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(
      sourceValues.reduce((sum, amount) => sum + amount, 0),
      7
    );
    const coarse = createAdaptiveTopology(bounds, { maximumSize: 128, minimumSize: 128 }, f.arena),
      coarsened = prepareAdaptiveTransfer(target, coarse, f.arena)(transferred, "extensive");
    expect(coarsened.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(
      sourceValues.reduce((sum, amount) => sum + amount, 0),
      7
    );
    f.arena.retain(transferred);
    f.arena.releaseProcess();
    expect(transferred.every(Number.isFinite)).toBe(true);
    expect(target.leaves.length).toBeGreaterThan(source.leaves.length);
    expect(f.arena.stats.reads).toBeGreaterThan(0);
    expect(f.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(65_536);
  } finally {
    f.close();
  }
});
it("locates both physical seam faces when one cell spans the cylinder", () => {
  const bounds: [number, number, number, number] = [0, 0, 1024, 512],
    topology = createAdaptiveTopology(bounds, { maximumSize: 1024, minimumSize: 1024 }),
    mesh = adaptivePhysicalMesh(topology, rectangle(bounds));
  mesh.joinSeam();
  const faces = [physicalFace(mesh, 0, 0), physicalFace(mesh, 0, 1)].sort((a, b) => a.x - b.x);
  expect(faces).toEqual([
    { x: -512, y: 0, nx: -1, ny: 0, length: 512 },
    { x: 512, y: 0, nx: 1, ny: 0, length: 512 },
  ]);
});
it("keeps reciprocal metric faces across an uneven cylindrical seam on disk", () => {
  const f = fixture();
  try {
    const bounds: [number, number, number, number] = [0, 0, 1024, 512],
      topology = createAdaptiveTopology(
        bounds,
        { maximumSize: 128, minimumSize: 16, refine: (box) => box[0] < 64 && box[1] < 192 },
        f.arena
      ),
      mesh = adaptivePhysicalMesh(topology, rectangle([0, 64, 1024, 448]));
    mesh.joinSeam();
    f.arena.releaseProcess();
    let seamFaces = 0,
      contentArea = 0;
    for (let i = 0; i < mesh.count; i++) {
      contentArea += mesh.contentArea(i);
      for (let e = 0; e < mesh.degree(i); e++) {
        const j = mesh.neighbor(i, e);
        expect(j).toBeGreaterThanOrEqual(0);
        const reverseEdge = edgeLeadingTo(mesh, j, i);
        expect(reverseEdge).toBeGreaterThanOrEqual(0);
        expect(mesh.faceLength(i, e)).toBeCloseTo(mesh.faceLength(j, reverseEdge), 10);
        if (Math.abs(mesh.x(j) - mesh.x(i)) > 512) seamFaces++;
      }
    }
    expect(seamFaces).toBeGreaterThan(0);
    expect(contentArea).toBe(1024 * 384);
    expect(f.arena.stats.peakDecodedBytes).toBeLessThanOrEqual(65_536);
  } finally {
    f.close();
  }
});
