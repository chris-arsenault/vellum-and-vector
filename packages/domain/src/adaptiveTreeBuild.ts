import type { Bounds } from "./spatial";
import {
  allocateAdaptiveTree,
  releaseAdaptiveTree,
  splitTreeBox,
  type AdaptiveTreeData,
} from "./adaptiveTree";
import { BlockCache } from "./lattice/blockCache";
import type { Band } from "./lattice/band";
import { sampleCoverage } from "./lattice/bandValues";

const decisionChunkSamples = 16_384;
/**
 * Disposable decisions keep a refiner's call order independent of allocation and writing.
 * They are planned before the tree's size is known, so they grow in chunk bands.
 */
class TreeDecisions {
  private readonly coverage;
  private chunks: Band[] = [];
  length = 0;
  constructor(cache: BlockCache) {
    this.coverage = sampleCoverage(decisionChunkSamples, cache);
  }
  push(split: boolean) {
    if (this.length % decisionChunkSamples === 0)
      this.chunks.push(this.coverage.scratch("uint8", "adaptive:decisions", decisionChunkSamples));
    this.chunks.at(-1)!.set(this.length++ % decisionChunkSamples, Number(split));
  }
  read(index: number) {
    return this.chunks[Math.floor(index / decisionChunkSamples)].get(index % decisionChunkSamples);
  }
  close() {
    for (const chunk of this.chunks) this.coverage.release(chunk);
    this.chunks = [];
  }
}
export function buildAdaptiveTree(
  bounds: Bounds,
  refine: (box: Bounds, level: number) => boolean,
  cache: BlockCache = new BlockCache(Infinity)
): AdaptiveTreeData {
  const decisions = new TreeDecisions(cache);
  try {
    const leaves = planTree(bounds, refine, decisions),
      tree = allocateAdaptiveTree(bounds, decisions.length, leaves, cache);
    try {
      writeTree(tree, decisions);
      return tree;
    } catch (error) {
      releaseAdaptiveTree(tree);
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
    for (let k = 0; k < 4; k++) tree.boxes.set(node * 4 + k, box[k]);
    tree.levels.set(node, level);
    if (decisions.read(nextDecision++)) {
      const child = nextNode;
      nextNode += 4;
      tree.children.set(node, child);
      splitTreeBox(box).forEach((bounds, i) => write(child + i, bounds, level + 1));
    } else {
      tree.leaves.set(leaf, node);
      tree.leafIndex.set(node, leaf++);
    }
  };
  write(0, tree.bounds, 0);
}
