import { z } from "zod";
import { finite } from "./schemas";
import type { AdaptiveTopology } from "./adaptiveTopology";
import { numericalSchema } from "./numericalSchema";
import { Coverage } from "./lattice/coverage";
import { everySample } from "./lattice/bandValues";

const scalar = numericalSchema("float64").refine((v) => everySample(v, Number.isFinite));
function validDimensions(t: AdaptiveTopology) {
  const nodes = t.children.length,
    count = t.leaves.length,
    faces = t.neighbors.length;
  return (
    t.boxes.length === nodes * 4 &&
    t.levels.length === nodes &&
    t.leafIndex.length === nodes &&
    t.offsets.length === count + 1 &&
    t.offsets.get(0) === 0 &&
    t.offsets.get(count) === faces &&
    [t.faceLengths, t.distances, t.directionX, t.directionY, t.normalX, t.normalY].every(
      (v) => v.length === faces
    )
  );
}
function validHierarchy(t: AdaptiveTopology) {
  const nodes = t.children.length,
    count = t.leaves.length;
  return (
    everySample(
      t.leaves,
      (node, i) =>
        node >= 0 && node < nodes && t.children.get(node) === -1 && t.leafIndex.get(node) === i
    ) &&
    everySample(t.children, (child, node) => child === -1 || (child > node && child + 3 < nodes)) &&
    everySample(t.neighbors, (i) => i >= 0 && i < count)
  );
}
export const adaptiveTopologySchema: z.ZodType<AdaptiveTopology> = z
  .object({
    bounds: z.tuple([finite, finite, finite, finite]),
    coverage: z.custom<Coverage>((value) => value instanceof Coverage),
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
    if (!validDimensions(t) || !validHierarchy(t))
      context.addIssue({
        code: "custom",
        message: "Adaptive topology arrays must describe one valid hierarchy and its faces.",
      });
  });
