import type { Bounds } from "./spatial";
import type { AdaptiveTopology } from "./adaptiveTopology";
import type { NumericalAllocator } from "./numericalVector";
import { allocateNumerical } from "./numericalAllocation";
import { buildAdaptiveTree } from "./adaptiveTreeBuild";
import { balanceAdaptiveTree } from "./adaptiveTreeBalance";
import { sourceTreeNode, treeBox } from "./adaptiveTree";
import { adaptiveFaces } from "./adaptiveFaces";
import { requireThat } from "./errors";

export function refineSelectedTree(
  source: AdaptiveTopology,
  selected: Iterable<number>,
  minimumSize: number,
  numerical?: NumericalAllocator
): AdaptiveTopology {
  const marked = allocateNumerical(
    {
      type: "uint8",
      length: source.children.length,
      lifetime: "process",
      name: "adaptive:selected",
    },
    numerical
  );
  let count = 0;
  try {
    for (const leaf of selected) {
      requireThat(
        Number.isSafeInteger(leaf) && leaf >= 0 && leaf < source.leaves.length,
        "adaptive_leaf",
        "Refine an existing adaptive leaf."
      );
      const node = source.leaves[leaf],
        box = treeBox(source, node);
      if (!marked[node] && Math.max(box[2] - box[0], box[3] - box[1]) > minimumSize) {
        marked[node] = 1;
        count++;
      }
    }
    if (!count) return source;
    return refineTree(
      source,
      (node, box, level) => source.levels[node] === level && !!marked[node],
      numerical
    );
  } finally {
    if (numerical) numerical.release(marked);
  }
}
export function refineWhereTree(
  source: AdaptiveTopology,
  minimumSize: number,
  refine: (box: Bounds) => boolean,
  numerical?: NumericalAllocator
): AdaptiveTopology {
  const needs = (box: Bounds) =>
    Math.max(box[2] - box[0], box[3] - box[1]) > minimumSize && refine(box);
  if (!source.leaves.some((node) => needs(treeBox(source, node)))) return source;
  return refineTree(source, (_node, box) => needs(box), numerical);
}
function refineTree(
  source: AdaptiveTopology,
  split: (node: number, box: Bounds, level: number) => boolean,
  numerical?: NumericalAllocator
): AdaptiveTopology {
  const tree = buildAdaptiveTree(
    source.bounds,
    (box, level) => {
      const node = sourceTreeNode(source, box, level);
      return source.children[node] >= 0 || split(node, box, level);
    },
    numerical
  );
  const balanced = balanceAdaptiveTree(tree, numerical);
  return { ...balanced, ...adaptiveFaces(balanced, numerical) };
}
