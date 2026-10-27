import { z } from "zod";
import { finite } from "./schemas";
import type { AdaptiveTopology } from "./adaptiveTopology";
import { numericalSchema } from "./numericalSchema";

const scalar = numericalSchema("float64").refine((v) => v.every(Number.isFinite));
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
    children: numericalSchema("int32"),
    levels: numericalSchema("uint8"),
    leaves: numericalSchema("int32"),
    leafIndex: numericalSchema("int32"),
    offsets: numericalSchema("int32"),
    neighbors: numericalSchema("int32"),
    faceLengths: scalar,
    distances: scalar,
    directionX: scalar,
    directionY: scalar,
    normalX: numericalSchema("int8"),
    normalY: numericalSchema("int8"),
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
