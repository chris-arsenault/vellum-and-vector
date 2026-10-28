// FlowGraphAlgorithms.cs and ConditionedFlowResolver.AccumulateContributingArea, Canonry 0f62584c.
import type { Band } from "@atlas/domain";
import type { PhysicalField } from "./field";
import { workingArray, releaseWorking } from "./physicalNumerics";

export const saturatingAdd = (a: number, b: number) => Math.min(2147483647, a + b);
export function sourceToOutletOrder(map: PhysicalField): Band {
  return targetOrder(map, map.FlowTargets);
}
/** Cells in an order where every cell precedes its target; a process band. */
export function targetOrder(map: PhysicalField, targets: Band): Band {
  const indegree = workingArray(map, "int32", "flow:indegree", targets.length),
    queue = workingArray(map, "int32", "flow:order", targets.length);
  try {
    fillTargetOrder(targets, indegree, queue);
    return queue;
  } catch (error) {
    releaseWorking(map, queue);
    throw error;
  } finally {
    releaseWorking(map, indegree);
  }
}
function fillTargetOrder(targets: Band, indegree: Band, queue: Band) {
  let count = 0;
  const n = targets.length;
  for (let i = 0; i < n; i++) {
    const target = targets.get(i);
    if (target >= 0) indegree.add(target, 1);
  }
  for (let i = 0; i < n; i++) if (indegree.get(i) === 0) queue.set(count++, i);
  for (let head = 0; head < count; head++) {
    const target = targets.get(queue.get(head));
    if (target < 0) continue;
    indegree.add(target, -1);
    if (indegree.get(target) === 0) queue.set(count++, target);
  }
  if (count !== n) throw new Error("Flow routing contains a cycle.");
}
/** Area draining through each cell along `targets`; a process band. */
export function contributingArea(map: PhysicalField, targets: Band): Band {
  const accumulated = workingArray(map, "float64", "flow:area", targets.length),
    order = targetOrder(map, targets);
  for (let i = 0; i < targets.length; i++) accumulated.set(i, map.mesh.area(i));
  for (let n = 0; n < order.length; n++) {
    const i = order.get(n),
      target = targets.get(i);
    if (target >= 0) accumulated.add(target, accumulated.get(i));
  }
  releaseWorking(map, order);
  return accumulated;
}
