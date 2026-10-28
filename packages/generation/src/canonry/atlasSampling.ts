import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import type { PhysicalMesh } from "./mesh";
import {
  allocateNumerical,
  Band,
  readNumericalBlock,
  writeNumericalBlock,
  type NumericalAllocator,
  type NumericalVector,
} from "@atlas/domain";
import { triangleSample } from "./triangleSampling";

const interpolationBlockSamples = 4096;
// One fan has a centre, a face neighbor and at most six incident vertex cells.
const triangleProjectionStride = 8;
export interface ProjectionInterpolation {
  samples: NumericalVector;
  degree: NumericalVector;
  cells: NumericalVector;
  weights: NumericalVector;
  stride: number;
}
/** Prepare physical fan weights through bounded blocks; the execution allocator owns them. */
export function projectionInterpolation(
  mesh: PhysicalMesh,
  count: number,
  position: (index: number) => [number, number],
  numerical?: NumericalAllocator
): ProjectionInterpolation {
  const allocate = (type: "int32" | "uint8" | "float64", length: number, name: string) =>
    allocateNumerical({ type, length, lifetime: "run", name: `projection:${name}` }, numerical);
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
  writeNumericalBlock(projection.samples, start, samples);
  writeNumericalBlock(projection.degree, start, degree);
  writeNumericalBlock(projection.cells, start * projection.stride, cells);
  writeNumericalBlock(projection.weights, start * projection.stride, weights);
}
function interpolate(
  projection: ProjectionInterpolation,
  valueAt: (index: number) => number,
  output: NumericalVector
) {
  for (let start = 0; start < projection.samples.length; start += interpolationBlockSamples) {
    const count = Math.min(interpolationBlockSamples, projection.samples.length - start);
    const degree = readNumericalBlock(projection.degree, start, count),
      cells = readNumericalBlock(
        projection.cells,
        start * projection.stride,
        count * projection.stride
      ),
      weights = readNumericalBlock(
        projection.weights,
        start * projection.stride,
        count * projection.stride
      ),
      result = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      if (!degree[i]) continue;
      const at = i * projection.stride,
        base = valueAt(cells[at]);
      let value = 0;
      for (let j = 0; j < degree[i]; j++)
        value += weights[at + j] * (valueAt(cells[at + j]) - base);
      result[i] = base + value;
    }
    writeNumericalBlock(output, start, result);
  }
  return output;
}
export function releaseProjection(
  projection: ProjectionInterpolation,
  numerical?: NumericalAllocator
) {
  if (numerical)
    for (const vector of [
      projection.samples,
      projection.degree,
      projection.cells,
      projection.weights,
    ])
      numerical.release(vector);
}
/** Reuse geometric weights across channels; identities always use a discrete sample. */
export function projectedValues(
  work: AtlasPhysicalWorkspace,
  values: Band | ArrayLike<number> | ((index: number) => number),
  discrete = false,
  output: NumericalVector = allocateNumerical(
    { type: "float64", length: work.samples.length, lifetime: "process", name: "projected" },
    work.numerical
  )
) {
  const valueAt =
    typeof values === "function"
      ? values
      : values instanceof Band
        ? (index: number) => values.get(index)
        : (index: number) => values[index];
  if (!discrete && work.interpolation) return interpolate(work.interpolation, valueAt, output);
  for (let i = 0; i < work.samples.length; i++) output[i] = valueAt(work.samples[i]);
  return output;
}
