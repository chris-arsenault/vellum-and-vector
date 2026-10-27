import type { NumericalAllocator } from "./numericalVector";
import { allocateNumerical } from "./numericalAllocation";
import { visitAdaptiveNeighbors } from "./adaptiveFaceQuery";
import { releaseAdaptiveTree, sourceTreeNode, type AdaptiveTreeData } from "./adaptiveTree";
import { buildAdaptiveTree } from "./adaptiveTreeBuild";

/** Grade interfaces before constructing CSR; intermediate face arrays never span the world. */
export function balanceAdaptiveTree(
  initial: AdaptiveTreeData,
  numerical?: NumericalAllocator
): AdaptiveTreeData {
  let tree = initial;
  for (;;) {
    const marked = allocateNumerical(
      {
        type: "uint8",
        length: tree.children.length,
        lifetime: "process",
        name: "adaptive:balance",
      },
      numerical
    );
    let count = 0;
    for (let i = 0; i < tree.leaves.length; i++) {
      const node = tree.leaves[i];
      visitAdaptiveNeighbors(tree, i, (target) => {
        if (!marked[node] && tree.levels[tree.leaves[target]] > tree.levels[node] + 1) {
          marked[node] = 1;
          count++;
        }
      });
    }
    if (!count) {
      if (numerical) numerical.release(marked);
      return tree;
    }
    const source = tree;
    try {
      tree = buildAdaptiveTree(
        source.bounds,
        (box, level) => {
          const node = sourceTreeNode(source, box, level);
          return source.children[node] >= 0 || (source.levels[node] === level && !!marked[node]);
        },
        numerical
      );
    } finally {
      if (numerical) numerical.release(marked);
    }
    releaseAdaptiveTree(source, numerical);
  }
}
