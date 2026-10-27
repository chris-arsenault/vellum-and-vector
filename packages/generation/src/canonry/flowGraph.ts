// FlowGraphAlgorithms.cs and ConditionedFlowResolver.AccumulateContributingArea, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import { allocateNumerical, type NumericalVector, type NumericalAllocator } from "@atlas/domain";

export const saturatingAdd = (a: number, b: number) => Math.min(2147483647, a + b);
export function sourceToOutletOrder(map: PhysicalField): NumericalVector {
  return targetOrder(map.FlowTargets, map.numerical);
}
export function targetOrder(
  targets: NumericalVector,
  numerical?: NumericalAllocator
): NumericalVector {
  const allocate = (name: string) =>
      allocateNumerical(
        { type: "int32", length: targets.length, lifetime: "process", name: `flow:${name}` },
        numerical
      ),
    indegree = allocate("indegree"),
    queue = allocate("order");
  try {
    fillTargetOrder(targets, indegree, queue);
    return queue;
  } catch (error) {
    numerical?.releaseUnused([queue], []);
    throw error;
  } finally {
    numerical?.releaseUnused([indegree], []);
  }
}
function fillTargetOrder(
  targets: NumericalVector,
  indegree: NumericalVector,
  queue: NumericalVector
) {
  let count = 0;
  for (const target of targets) if (target >= 0) indegree[target]++;
  for (let i = 0; i < targets.length; i++) if (indegree[i] === 0) queue[count++] = i;
  for (let head = 0; head < count; head++) {
    const target = targets[queue[head]];
    if (target >= 0 && --indegree[target] === 0) queue[count++] = target;
  }
  if (count !== targets.length) throw new Error("Flow routing contains a cycle.");
}
export function contributingArea(
  targets: NumericalVector,
  areas: NumericalVector,
  numerical?: NumericalAllocator
): NumericalVector {
  const accumulated = allocateNumerical(
      { type: "float64", length: areas.length, lifetime: "process", name: "flow:area" },
      numerical
    ),
    order = targetOrder(targets, numerical);
  accumulated.set(areas);
  for (const i of order) {
    const target = targets[i];
    if (target >= 0) accumulated[target] += accumulated[i];
  }
  numerical?.releaseUnused([order], []);
  return accumulated;
}
