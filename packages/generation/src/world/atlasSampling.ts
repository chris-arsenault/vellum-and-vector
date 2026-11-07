import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import type { PhysicalMesh } from "./mesh";
import { Band, readRange, writeRange, type Coverage } from "@atlas/domain";
import { triangleSample } from "./triangleSampling";

const interpolationBlockSamples = 4096;
// One fan has a centre, a face neighbor and at most six incident vertex cells.
const triangleProjectionStride = 8;
/** Fan weights from the physical mesh to each surface sample, as bands of the grid coverage. */
export interface ProjectionInterpolation {
  samples: Band;
  degree: Band;
  cells: Band;
  weights: Band;
  stride: number;
}
/** Prepare physical fan weights through bounded blocks in the surface grid's coverage. */
export function projectionInterpolation(
  mesh: PhysicalMesh,
  count: number,
  position: (index: number) => [number, number],
  coverage: Coverage
): ProjectionInterpolation {
  const allocate = (type: "int32" | "uint8" | "float64", length: number, name: string) => {
    const band = coverage.scratch(type, `projection:${name}`, length);
    band.retain();
    return band;
  };
  const projection: ProjectionInterpolation = {
    samples: allocate("int32", count, "samples"),
    degree: allocate("uint8", count, "degree"),
    cells: allocate("int32", count * triangleProjectionStride, "cells"),
    weights: allocate("float64", count * triangleProjectionStride, "weights"),
    stride: triangleProjectionStride,
  };
  for (let start = 0; start < count; start += interpolationBlockSamples)
    writeProjectionBlock(
      mesh,
      projection,
      start,
      Math.min(interpolationBlockSamples, count - start),
      position
    );
  return projection;
}
function writeProjectionBlock(
  mesh: PhysicalMesh,
  projection: ProjectionInterpolation,
  start: number,
  count: number,
  position: (index: number) => [number, number]
) {
  const samples = new Int32Array(count),
    degree = new Uint8Array(count),
    cells = new Int32Array(count * projection.stride),
    weights = new Float64Array(cells.length);
  for (let i = 0; i < count; i++) {
    const [x, y] = position(start + i),
      sample = triangleSample(mesh, x, y);
    samples[i] = sample.cell;
    degree[i] = sample.cells.length;
    cells.set(sample.cells, i * projection.stride);
    weights.set(sample.weights, i * projection.stride);
  }
  writeRange(projection.samples, start, samples);
  writeRange(projection.degree, start, degree);
  writeRange(projection.cells, start * projection.stride, cells);
  writeRange(projection.weights, start * projection.stride, weights);
}
function interpolate(
  projection: ProjectionInterpolation,
  valueAt: (index: number) => number,
  output: Band
) {
  const stride = projection.stride;
  for (let start = 0; start < projection.samples.length; start += interpolationBlockSamples) {
    const count = Math.min(interpolationBlockSamples, projection.samples.length - start);
    const degree = readRange(projection.degree, start, count),
      cells = readRange(projection.cells, start * stride, count * stride),
      weights = readRange(projection.weights, start * stride, count * stride),
      result = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      if (!degree[i]) continue;
      const at = i * stride,
        base = valueAt(cells[at]);
      let value = 0;
      for (let j = 0; j < degree[i]; j++)
        value += weights[at + j] * (valueAt(cells[at + j]) - base);
      result[i] = base + value;
    }
    writeRange(output, start, result);
  }
  return output;
}
export function releaseProjection(projection: ProjectionInterpolation) {
  for (const band of [projection.samples, projection.degree, projection.cells, projection.weights])
    band.release();
}
/**
 * Reuse geometric weights across channels; identities always use a discrete sample. The
 * default output is a process band in the coverage that holds the workspace's samples.
 */
export function projectedValues(
  work: AtlasPhysicalWorkspace,
  values: Band | ArrayLike<number> | ((index: number) => number),
  discrete = false,
  output: Band = work.grid.scratch("float64", "projected", work.samples.length)
) {
  const valueAt =
    typeof values === "function"
      ? values
      : values instanceof Band
        ? (index: number) => values.get(index)
        : (index: number) => values[index];
  if (!discrete && work.interpolation) return interpolate(work.interpolation, valueAt, output);
  const samples = work.samples;
  for (let i = 0; i < samples.length; i++) output.set(i, valueAt(samples.get(i)));
  return output;
}
