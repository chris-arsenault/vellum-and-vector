import { z } from "zod";
import { finite } from "./schemas";
import type { AdaptiveTopology } from "./adaptiveTopology";

const scalar = z.instanceof(Float64Array).refine((v) => v.every(Number.isFinite));
function validDimensions(t: AdaptiveTopology) {
  const nodes = t.children.length,
    count = t.leaves.length,
    faces = t.neighbors.length;
  return (
    t.boxes.length === nodes * 4 &&
    t.levels.length === nodes &&
    t.leafIndex.length === nodes &&
    t.offsets.length === count + 1 &&
    t.offsets[0] === 0 &&
    t.offsets[count] === faces &&
    [t.faceLengths, t.distances, t.directionX, t.directionY, t.normalX, t.normalY].every(
      (v) => v.length === faces
    )
  );
}
export const adaptiveTopologySchema: z.ZodType<AdaptiveTopology> = z
  .object({
    bounds: z.tuple([finite, finite, finite, finite]),
    boxes: scalar,
    children: z.instanceof(Int32Array),
    levels: z.instanceof(Uint8Array),
    leaves: z.instanceof(Int32Array),
    leafIndex: z.instanceof(Int32Array),
    offsets: z.instanceof(Int32Array),
    neighbors: z.instanceof(Int32Array),
    faceLengths: scalar,
    distances: scalar,
    directionX: scalar,
    directionY: scalar,
    normalX: z.instanceof(Int8Array),
    normalY: z.instanceof(Int8Array),
  })
  .strict()
  .superRefine((t, context) => {
    const nodes = t.children.length,
      count = t.leaves.length;
    const valid =
      validDimensions(t) &&
      t.leaves.every(
        (node, i) => node >= 0 && node < nodes && t.children[node] === -1 && t.leafIndex[node] === i
      ) &&
      t.children.every((child, node) => child === -1 || (child > node && child + 3 < nodes)) &&
      t.neighbors.every((i) => i >= 0 && i < count);
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "Adaptive topology arrays must describe one valid hierarchy and its faces.",
      });
  });
