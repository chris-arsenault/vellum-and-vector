import type { Band } from "@atlas/domain";
import type { PhysicalField } from "./field";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** Closed worlds seed the deepest basin; open meshes seed every physical boundary cell. */
export function* oceanSeeds(map: PhysicalField) {
  let count = 0,
    deepest = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.boundary(i)) {
      yield i;
      count++;
    }
    if (map.Elevation.get(i) < map.Elevation.get(deepest)) deepest = i;
  }
  if (!count) yield deepest;
}
export class OceanComponents {
  private readonly seeds: Band;
  readonly parent: Band;
  readonly sizes: Band;
  readonly contents: Band;
  readonly boundary: Band;
  connected = 0;
  constructor(private readonly map: PhysicalField) {
    this.seeds = workingArray(map, "uint8", "ocean:seeds");
    for (const seed of oceanSeeds(map)) this.seeds.set(seed, 1);
    this.parent = workingArray(map, "int32", "ocean:parent").fill(-1);
    this.sizes = workingArray(map, "int32", "ocean:sizes");
    this.contents = workingArray(map, "float64", "ocean:contents");
    this.boundary = workingArray(map, "uint8", "ocean:boundary");
  }
  activate(i: number) {
    this.parent.set(i, i);
    this.sizes.set(i, 1);
    const content = this.map.mesh.contentArea(i);
    this.contents.set(i, content);
    const seed = this.seeds.get(i);
    this.boundary.set(i, seed);
    if (seed) this.connected += content;
  }
  root(i: number): number {
    let root = i;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(i) !== i) {
      const next = this.parent.get(i);
      this.parent.set(i, root);
      i = next;
    }
    return root;
  }
  union(first: number, second: number) {
    let a = this.root(first),
      b = this.root(second);
    if (a === b) return;
    if (this.sizes.get(a) < this.sizes.get(b)) [a, b] = [b, a];
    if (this.boundary.get(a)) this.connected -= this.contents.get(a);
    if (this.boundary.get(b)) this.connected -= this.contents.get(b);
    this.parent.set(b, a);
    this.sizes.add(a, this.sizes.get(b));
    this.contents.add(a, this.contents.get(b));
    this.boundary.set(a, this.boundary.get(a) | this.boundary.get(b));
    if (this.boundary.get(a)) this.connected += this.contents.get(a);
  }
  close() {
    releaseWorking(this.map, this.seeds, this.parent, this.sizes, this.contents, this.boundary);
  }
}
/** A bounded decoded FIFO visits connected ocean cells once, including nonlocal seam faces. */
export function visitConnectedOcean(map: PhysicalField, level: number, visit: (i: number) => void) {
  const seen = workingArray(map, "uint8", "ocean:seen"),
    queue = workingArray(map, "int32", "ocean:flood");
  let count = 0;
  const add = (i: number) => {
    if (i < 0 || seen.get(i) || map.Elevation.get(i) >= level) return;
    seen.set(i, 1);
    queue.set(count++, i);
    visit(i);
  };
  try {
    for (const seed of oceanSeeds(map)) add(seed);
    for (let head = 0; head < count; head++) {
      const i = queue.get(head);
      for (let edge = 0; edge < map.mesh.degree(i); edge++) add(map.mesh.neighbor(i, edge));
    }
  } finally {
    releaseWorking(map, seen, queue);
  }
}
