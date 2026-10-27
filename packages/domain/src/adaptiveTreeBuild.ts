import type { Bounds } from "./spatial";
import type { NumericalAllocator, NumericalVector } from "./numericalVector";
import { allocateNumerical } from "./numericalAllocation";
import {
  allocateAdaptiveTree,
  releaseAdaptiveTree,
  splitTreeBox,
  type AdaptiveTreeData,
} from "./adaptiveTree";

const decisionChunkSamples = 16_384;
/** Disposable decisions keep a refiner's call order independent of allocation and writing. */
class TreeDecisions {
  private chunks: NumericalVector[] = [];
  length = 0;
  constructor(private numerical?: NumericalAllocator) {}
  push(split: boolean) {
    if (this.length % decisionChunkSamples === 0)
      this.chunks.push(
        allocateNumerical(
          {
            type: "uint8",
            length: decisionChunkSamples,
            lifetime: "process",
            name: "adaptive:decisions",
          },
          this.numerical
        )
      );
    this.chunks.at(-1)![this.length++ % decisionChunkSamples] = Number(split);
  }
  read(index: number) {
    return this.chunks[Math.floor(index / decisionChunkSamples)][index % decisionChunkSamples];
  }
  close() {
    if (this.numerical) for (const chunk of this.chunks) this.numerical.release(chunk);
    this.chunks = [];
  }
}
export function buildAdaptiveTree(
  bounds: Bounds,
  refine: (box: Bounds, level: number) => boolean,
  numerical?: NumericalAllocator
): AdaptiveTreeData {
  const decisions = new TreeDecisions(numerical);
  try {
    const leaves = planTree(bounds, refine, decisions),
      tree = allocateAdaptiveTree(bounds, decisions.length, leaves, numerical);
    try {
      writeTree(tree, decisions);
      return tree;
    } catch (error) {
      releaseAdaptiveTree(tree, numerical);
      throw error;
    }
  } finally {
    decisions.close();
  }
}
function planTree(
  bounds: Bounds,
  refine: (box: Bounds, level: number) => boolean,
  decisions: TreeDecisions
) {
  let leaves = 0;
  const visit = (box: Bounds, level: number) => {
    const split = refine(box, level);
    decisions.push(split);
    if (split) for (const child of splitTreeBox(box)) visit(child, level + 1);
    else leaves++;
  };
  visit(bounds, 0);
  return leaves;
}
function writeTree(tree: AdaptiveTreeData, decisions: TreeDecisions) {
  let nextNode = 1,
    nextDecision = 0,
    leaf = 0;
  const write = (node: number, box: Bounds, level: number) => {
    tree.boxes.set(box, node * 4);
    tree.levels[node] = level;
    if (decisions.read(nextDecision++)) {
      const child = nextNode;
      nextNode += 4;
      tree.children[node] = child;
      splitTreeBox(box).forEach((bounds, i) => write(child + i, bounds, level + 1));
    } else {
      tree.leaves[leaf] = node;
      tree.leafIndex[node] = leaf++;
    }
  };
  write(0, tree.bounds, 0);
}
