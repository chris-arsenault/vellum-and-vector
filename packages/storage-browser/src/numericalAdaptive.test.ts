import { expect, it } from "vitest";
import {
  adaptiveCell,
  createAdaptiveTopology,
  everySample,
  foldSamples,
  generateBand,
  refineAdaptiveWhere,
  prepareAdaptiveTransfer,
  rectangle,
} from "@atlas/domain";
import { adaptivePhysicalMesh } from "../../generation/src/canonry/adaptiveMesh";
import { edgeLeadingTo } from "../../generation/src/canonry/mesh";
import { blockCacheFixture } from "./blockCacheFixture";
import { physicalFace } from "../../generation/src/canonry/physicalMetric";

/** One full float64 block resident: topology and material bands evict to scratch and reload. */
const blockBudget = 16_384 * 8;
const total = (values: Parameters<typeof foldSamples>[0]) =>
  foldSamples(values, (sum: number, amount) => sum + amount, 0);
it("refines on an evicting cache and transfers all material across unchanged, split and coarsened cells", () => {
  const f = blockCacheFixture(blockBudget);
  try {
    const bounds: [number, number, number, number] = [0, 0, 1024, 1024],
      source = createAdaptiveTopology(
        bounds,
        { maximumSize: 64, minimumSize: 32, refine: (box) => box[0] < 256 },
        f.cache
      ),
      target = refineAdaptiveWhere(source, 16, (box) => box[0] > 700 && box[1] < 400),
      sourceValues = generateBand(source.coverage, "float64", "test:material", (i) => {
        const box = adaptiveCell(source, i);
        return (box[2] - box[0]) * (box[3] - box[1]) * (1 + (box[0] + box[2]) / 2048);
      }),
      transferred = prepareAdaptiveTransfer(source, target)(sourceValues, "extensive");
    expect(total(transferred)).toBeCloseTo(total(sourceValues), 7);
    const coarse = createAdaptiveTopology(bounds, { maximumSize: 128, minimumSize: 128 }, f.cache),
      coarsened = prepareAdaptiveTransfer(target, coarse)(transferred, "extensive");
    expect(total(coarsened)).toBeCloseTo(total(sourceValues), 7);
    target.coverage.releaseProcess();
    expect(everySample(transferred, Number.isFinite)).toBe(true);
    expect(target.leaves.length).toBeGreaterThan(source.leaves.length);
    expect(f.cache.stats.evictions).toBeGreaterThan(0);
    expect(f.scratch.stats.reads).toBeGreaterThan(0);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(blockBudget);
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
it("keeps reciprocal metric faces across an uneven cylindrical seam on an evicting cache", () => {
  const f = blockCacheFixture(blockBudget);
  try {
    const bounds: [number, number, number, number] = [0, 0, 1024, 512],
      topology = createAdaptiveTopology(
        bounds,
        { maximumSize: 128, minimumSize: 16, refine: (box) => box[0] < 64 && box[1] < 192 },
        f.cache
      ),
      mesh = adaptivePhysicalMesh(topology, rectangle([0, 64, 1024, 448]));
    mesh.joinSeam();
    topology.coverage.releaseProcess();
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
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(blockBudget);
  } finally {
    f.close();
  }
});
