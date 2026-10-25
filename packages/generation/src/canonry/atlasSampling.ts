import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import type { PhysicalMesh } from "./mesh";
import { triangleSample } from "./triangleSampling";

// Temporary sample objects are confined to one batch, rather than retained per map cell.
const interpolationBatchSize = 4096;
export interface ProjectionInterpolation {
  samples: Int32Array;
  batches: { offsets: Uint32Array; cells: Int32Array; weights: Float64Array }[];
}

/** Keep the same fan weights in compact typed storage, including seam and pole support. */
export function projectionInterpolation(
  mesh: PhysicalMesh,
  count: number,
  position: (index: number) => [number, number]
): ProjectionInterpolation {
  const samples = new Int32Array(count),
    batches: ProjectionInterpolation["batches"] = [];
  for (let start = 0; start < count; start += interpolationBatchSize) {
    const batch = Array.from(
      { length: Math.min(interpolationBatchSize, count - start) },
      (_, i) => {
        const [x, y] = position(start + i);
        return triangleSample(mesh, x, y);
      }
    );
    const length = batch.reduce((sum, sample) => sum + sample.cells.length, 0),
      cells = new Int32Array(length),
      weights = new Float64Array(length),
      offsets = new Uint32Array(batch.length + 1);
    for (const [i, sample] of batch.entries()) {
      samples[start + i] = sample.cell;
      cells.set(sample.cells, offsets[i]);
      weights.set(sample.weights, offsets[i]);
      offsets[i + 1] = offsets[i] + sample.cells.length;
    }
    batches.push({ offsets, cells, weights });
  }
  return { samples, batches };
}

function interpolate(
  interpolation: ProjectionInterpolation,
  values: ArrayLike<number>,
  output: Float64Array
) {
  let index = 0;
  for (const { offsets, cells, weights } of interpolation.batches)
    for (let i = 0; i < offsets.length - 1; i++, index++) {
      const start = offsets[i],
        end = offsets[i + 1];
      if (start === end) {
        output[index] = 0;
        continue;
      }
      const base = values[cells[start]];
      let value = 0;
      for (let j = start; j < end; j++) value += weights[j] * (values[cells[j]] - base);
      output[index] = base + value;
    }
  return output;
}

/** Reuse geometric weights across channels; identities always use a discrete sample. */
export function projectedValues(
  work: AtlasPhysicalWorkspace,
  values: ArrayLike<number>,
  discrete = false,
  output: Float64Array = new Float64Array(work.samples.length)
) {
  if (!discrete && work.interpolation) return interpolate(work.interpolation, values, output);
  for (let i = 0; i < work.samples.length; i++) output[i] = values[work.samples[i]];
  return output;
}
