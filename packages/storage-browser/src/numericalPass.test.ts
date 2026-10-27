import { mkdtempSync, openSync, readSync, writeSync, fsyncSync, closeSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { SampleArray, SampleType } from "@atlas/domain";
import { metricProduct, type MetricOperator } from "../../generation/src/canonry/metricOperator";
import { PagedArena } from "./pagedArena";

function matrix(count: number): MetricOperator {
  const offsets = new Int32Array(count + 1),
    neighbors = new Int32Array((count - 1) * 2);
  let at = 0;
  for (let i = 0; i < count; i++) {
    offsets[i] = at;
    if (i > 0) neighbors[at++] = i - 1;
    if (i + 1 < count) neighbors[at++] = i + 1;
  }
  offsets[count] = at;
  return {
    cells: Int32Array.from({ length: count }, (_, i) => i),
    areas: new Float64Array(count).fill(2),
    diagonal: new Float64Array(count).fill(3),
    offsets,
    neighbors,
    weights: new Float64Array(neighbors.length).fill(0.5),
  };
}
it("executes the real finite-volume product across disk pages and mathematical block boundaries", () => {
  const count = 40_000,
    source = matrix(count),
    values = Float64Array.from({ length: count }, (_, i) => Math.sin(i / 19));
  const expected = new Float64Array(count);
  const nativeStart = performance.now();
  metricProduct(source, values, expected);
  const nativeMs = performance.now() - nativeStart;
  const directory = mkdtempSync(join(tmpdir(), "atlas-pass-")),
    fd = openSync(join(directory, "work.bin"), "w+");
  const arena = new PagedArena(
    {
      read: (bytes, offset) => readSync(fd, bytes, 0, bytes.byteLength, offset),
      write: (bytes, offset) => writeSync(fd, bytes, 0, bytes.byteLength, offset),
      flush: () => fsyncSync(fd),
      close: () => closeSync(fd),
    },
    262_144,
    1024
  );
  try {
    const copy = (type: SampleType, samples: SampleArray) => {
      const vector = arena.allocate({
        type,
        length: samples.length,
        lifetime: "run",
        name: "operator",
      });
      arena.write(vector, 0, samples);
      return vector;
    };
    const disk: MetricOperator = {
      cells: copy("int32", source.cells as Int32Array),
      areas: copy("float64", source.areas as Float64Array),
      diagonal: copy("float64", source.diagonal as Float64Array),
      offsets: copy("int32", source.offsets as Int32Array),
      neighbors: copy("int32", source.neighbors as Int32Array),
      weights: copy("float64", source.weights as Float64Array),
    };
    const input = copy("float64", values),
      result = arena.allocate({
        type: "float64",
        length: count,
        lifetime: "process",
        name: "product",
      });
    const diskStart = performance.now();
    metricProduct(disk, input, result);
    const diskMs = performance.now() - diskStart;
    expect(Array.from(result)).toEqual(Array.from(expected));
    expect(arena.stats.peakDecodedBytes).toBeLessThanOrEqual(262_144);
    console.info("finite-volume product", {
      samples: count,
      nativeMs,
      diskMs,
      readBytes: arena.stats.readBytes,
      writtenBytes: arena.stats.writtenBytes,
    });
  } finally {
    arena.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
