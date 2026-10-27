import type { NumericalVector } from "@atlas/domain";
import type { PhysicalField } from "./field";
import { workingArray, releaseWorking } from "./physicalNumerics";

/** Closed worlds seed the deepest basin; open meshes seed every physical boundary cell. */
export function* oceanSeeds(map: PhysicalField) {
  let count = 0,
    deepest = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.boundary[i]) {
      yield i;
      count++;
    }
    if (map.Elevation[i] < map.Elevation[deepest]) deepest = i;
  }
  if (!count) yield deepest;
}
export class OceanComponents {
  private readonly seeds: NumericalVector;
  readonly parent: NumericalVector;
  readonly sizes: NumericalVector;
  readonly contents: NumericalVector;
  readonly boundary: NumericalVector;
  connected = 0;
  constructor(private readonly map: PhysicalField) {
    this.seeds = workingArray(map, "uint8", "ocean:seeds");
    for (const seed of oceanSeeds(map)) this.seeds[seed] = 1;
    this.parent = workingArray(map, "int32", "ocean:parent").fill(-1);
    this.sizes = workingArray(map, "int32", "ocean:sizes");
    this.contents = workingArray(map, "float64", "ocean:contents");
    this.boundary = workingArray(map, "uint8", "ocean:boundary");
  }
  activate(i: number) {
    this.parent[i] = i;
    this.sizes[i] = 1;
    this.contents[i] = this.map.mesh.contentAreas[i];
    this.boundary[i] = this.seeds[i];
    if (this.boundary[i]) this.connected += this.contents[i];
  }
  root(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== i) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  union(first: number, second: number) {
    let a = this.root(first),
      b = this.root(second);
    if (a === b) return;
    if (this.sizes[a] < this.sizes[b]) [a, b] = [b, a];
    if (this.boundary[a]) this.connected -= this.contents[a];
    if (this.boundary[b]) this.connected -= this.contents[b];
    this.parent[b] = a;
    this.sizes[a] += this.sizes[b];
    this.contents[a] += this.contents[b];
    this.boundary[a] |= this.boundary[b];
    if (this.boundary[a]) this.connected += this.contents[a];
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
    if (i < 0 || seen[i] || map.Elevation[i] >= level) return;
    seen[i] = 1;
    queue[count++] = i;
    visit(i);
  };
  try {
    for (const seed of oceanSeeds(map)) add(seed);
    for (let head = 0; head < count; head++) {
      const i = queue[head];
      for (let edge = 0; edge < map.mesh.degree[i]; edge++)
        add(map.mesh.neighbors[i * map.mesh.stride + edge]);
    }
  } finally {
    releaseWorking(map, seen, queue);
  }
}
