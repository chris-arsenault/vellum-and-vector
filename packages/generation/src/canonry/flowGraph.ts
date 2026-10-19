// FlowGraphAlgorithms.cs and ConditionedFlowResolver.AccumulateContributingArea, Canonry 0f62584c.
import type { PhysicalField } from "./field";

export const saturatingAdd = (a: number, b: number) => Math.min(2147483647, a + b);
export function sourceToOutletOrder(map: PhysicalField): number[] {
  return targetOrder(map.FlowTargets);
}
export function targetOrder(targets: Int32Array): number[] {
  const indegree = new Int32Array(targets.length),
    queue: number[] = [];
  for (const target of targets) if (target >= 0) indegree[target]++;
  for (let i = 0; i < targets.length; i++) if (indegree[i] === 0) queue.push(i);
  for (let head = 0; head < queue.length; head++) {
    const target = targets[queue[head]];
    if (target >= 0 && --indegree[target] === 0) queue.push(target);
  }
  if (queue.length !== targets.length) throw new Error("Flow routing contains a cycle.");
  return queue;
}
export function contributingArea(targets: Int32Array, areas: Float64Array): Float64Array {
  const accumulated = areas.slice();
  for (const i of targetOrder(targets)) {
    const target = targets[i];
    if (target >= 0) accumulated[target] += accumulated[i];
  }
  return accumulated;
}
