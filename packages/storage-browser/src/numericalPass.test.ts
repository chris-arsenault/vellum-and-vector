import { expect, it } from "vitest";
import type { BlockCache } from "@atlas/domain";
import {
  metricArray,
  metricProduct,
  type MetricOperator,
} from "../../generation/src/canonry/metricOperator";
import { createField, type PhysicalField } from "../../generation/src/canonry/field";
import { createMesh } from "../../generation/src/canonry/mesh";
import { blockCacheFixture } from "./blockCacheFixture";

function matrix(map: PhysicalField, count: number): MetricOperator {
  const offsets = metricArray(map, "offsets", count + 1, "int32"),
    neighbors = metricArray(map, "neighbors", (count - 1) * 2, "int32");
  let at = 0;
  for (let i = 0; i < count; i++) {
    offsets.set(i, at);
    if (i > 0) neighbors.set(at++, i - 1);
    if (i + 1 < count) neighbors.set(at++, i + 1);
  }
  offsets.set(count, at);
  return {
    map,
    count,
    areas: metricArray(map, "areas", count).fill(2),
    diagonal: metricArray(map, "diagonal", count).fill(3),
    offsets,
    neighbors,
    weights: metricArray(map, "weights", neighbors.length).fill(0.5),
  };
}
function product(cache: BlockCache | undefined, count: number, values: Float64Array) {
  const map = createField(createMesh(count, 0), cache),
    source = matrix(map, count),
    input = metricArray(map, "input", count),
    result = metricArray(map, "product", count);
  values.forEach((value, i) => input.set(i, value));
  const start = performance.now();
  metricProduct(source, input, result);
  return { result: Array.from(result), ms: performance.now() - start };
}
it("executes the real finite-volume product across disk pages and mathematical block boundaries", () => {
  const count = 40_000,
    values = Float64Array.from({ length: count }, (_, i) => Math.sin(i / 19));
  const native = product(undefined, count, values);
  const f = blockCacheFixture(262_144);
  try {
    const disk = product(f.cache, count, values);
    expect(disk.result).toEqual(native.result);
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(262_144);
    console.info("finite-volume product", {
      samples: count,
      nativeMs: native.ms,
      diskMs: disk.ms,
      loads: f.cache.stats.loads,
      evictions: f.cache.stats.evictions,
      readBytes: f.scratch.stats.readBytes,
      writtenBytes: f.scratch.stats.writtenBytes,
    });
  } finally {
    f.close();
  }
});
