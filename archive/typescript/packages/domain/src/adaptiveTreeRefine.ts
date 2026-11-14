import type { Bounds } from "./spatial";
import type { AdaptiveTopology } from "./adaptiveTopology";
import { buildAdaptiveTree } from "./adaptiveTreeBuild";
import { balanceAdaptiveTree } from "./adaptiveTreeBalance";
import { sourceTreeNode, treeBox } from "./adaptiveTree";
import { adaptiveFaces } from "./adaptiveFaces";
import { requireThat } from "./errors";

export function refineSelectedTree(
  source: AdaptiveTopology,
  selected: Iterable<number>,
  minimumSize: number
): AdaptiveTopology {
  const marked = source.coverage.scratch("uint8", "adaptive:selected", source.children.length);
  let count = 0;
  try {
    for (const leaf of selected) {
      requireThat(
        Number.isSafeInteger(leaf) && leaf >= 0 && leaf < source.leaves.length,
        "adaptive_leaf",
        "Refine an existing adaptive leaf."
      );
      const node = source.leaves.get(leaf),
        box = treeBox(source, node);
      if (!marked.get(node) && Math.max(box[2] - box[0], box[3] - box[1]) > minimumSize) {
        marked.set(node, 1);
        count++;
      }
    }
    if (!count) return source;
    return refineTree(
      source,
      (node, _box, level) => source.levels.get(node) === level && !!marked.get(node)
    );
  } finally {
    source.coverage.release(marked);
  }
}
export function refineWhereTree(
  source: AdaptiveTopology,
  minimumSize: number,
  refine: (box: Bounds) => boolean
): AdaptiveTopology {
  const needs = (box: Bounds) =>
    Math.max(box[2] - box[0], box[3] - box[1]) > minimumSize && refine(box);
  let any = false;
  for (let leaf = 0; leaf < source.leaves.length && !any; leaf++)
    any = needs(treeBox(source, source.leaves.get(leaf)));
  if (!any) return source;
  return refineTree(source, (_node, box) => needs(box));
}
function refineTree(
  source: AdaptiveTopology,
  split: (node: number, box: Bounds, level: number) => boolean
): AdaptiveTopology {
  const tree = buildAdaptiveTree(
    source.bounds,
    (box, level) => {
      const node = sourceTreeNode(source, box, level);
      return source.children.get(node) >= 0 || split(node, box, level);
    },
    source.coverage.cache
  );
  const balanced = balanceAdaptiveTree(tree);
  return { ...balanced, ...adaptiveFaces(balanced) };
}
