import { visitAdaptiveNeighbors } from "./adaptiveFaceQuery";
import { releaseAdaptiveTree, sourceTreeNode, type AdaptiveTreeData } from "./adaptiveTree";
import { buildAdaptiveTree } from "./adaptiveTreeBuild";

/** Grade interfaces before constructing CSR; intermediate face arrays never span the world. */
export function balanceAdaptiveTree(initial: AdaptiveTreeData): AdaptiveTreeData {
  let tree = initial;
  for (;;) {
    const marked = tree.coverage.scratch("uint8", "adaptive:balance", tree.children.length);
    let count = 0;
    for (let i = 0; i < tree.leaves.length; i++) {
      const node = tree.leaves.get(i),
        level = tree.levels.get(node);
      visitAdaptiveNeighbors(tree, i, (target) => {
        if (!marked.get(node) && tree.levels.get(tree.leaves.get(target)) > level + 1) {
          marked.set(node, 1);
          count++;
        }
      });
    }
    if (!count) {
      tree.coverage.release(marked);
      return tree;
    }
    const source = tree;
    try {
      tree = buildAdaptiveTree(
        source.bounds,
        (box, level) => {
          const node = sourceTreeNode(source, box, level);
          return (
            source.children.get(node) >= 0 ||
            (source.levels.get(node) === level && !!marked.get(node))
          );
        },
        source.coverage.cache
      );
    } finally {
      source.coverage.release(marked);
    }
    releaseAdaptiveTree(source);
  }
}
