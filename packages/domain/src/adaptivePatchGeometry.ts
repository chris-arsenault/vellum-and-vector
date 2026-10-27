import { adaptiveCell, adaptiveLeafAt, type AdaptiveTopology } from "./adaptiveTopology";
import type { Bounds } from "./spatial";
import { ByteCache } from "./byteCache";

const geometryCacheBytes = 1024 * 1024;

export interface AdaptiveVertex {
  id: number;
  x: number;
  y: number;
  epsilon: number;
  cells: number[];
  hanging: number | undefined;
  coarse: number | undefined;
}
interface Cell {
  box: Bounds;
  width: number;
  height: number;
  corners: AdaptiveVertex[];
}

function incident(t: AdaptiveTopology, x: number, y: number, epsilon: number) {
  const leaves = new Set<number>();
  for (const dx of [-epsilon, epsilon])
    for (const dy of [-epsilon, epsilon]) {
      const leaf = adaptiveLeafAt(t, x + dx, y + dy);
      if (leaf >= 0) leaves.add(leaf);
    }
  return [...leaves];
}
function prepare(t: AdaptiveTopology) {
  const vertices = new ByteCache<string, AdaptiveVertex>(geometryCacheBytes),
    cells = new ByteCache<number, Cell>(geometryCacheBytes);
  let nextVertexId = 0;
  function vertex(x: number, y: number, epsilon: number): AdaptiveVertex {
    const key = `${x}:${y}`,
      previous = vertices.get(key);
    if (previous) return previous;
    const neighbors = incident(t, x, y, epsilon);
    const hanging = neighbors.filter((i) => {
      const b = adaptiveCell(t, i);
      return (x > b[0] && x < b[2]) || (y > b[1] && y < b[3]);
    });
    const result = {
      id: nextVertexId++,
      x,
      y,
      epsilon,
      cells: neighbors,
      hanging: hanging[0],
      coarse: hanging.sort((a, b) => t.levels[t.leaves[a]] - t.levels[t.leaves[b]])[0],
    };
    vertices.set(key, result, 192 + key.length * 2 + neighbors.length * 8);
    return result;
  }
  function cell(i: number) {
    const previous = cells.get(i);
    if (previous) return previous;
    const box = adaptiveCell(t, i),
      [x0, y0, x1, y1] = box,
      width = x1 - x0,
      height = y1 - y0,
      epsilon = Math.min(width, height) * 1e-6;
    const result = {
      box,
      width,
      height,
      corners: [
        vertex(x0, y0, epsilon),
        vertex(x1, y0, epsilon),
        vertex(x0, y1, epsilon),
        vertex(x1, y1, epsilon),
      ],
    };
    cells.set(i, result, 512);
    return result;
  }
  return { vertex, cell };
}
const preparations = new WeakMap<AdaptiveTopology, ReturnType<typeof prepare>>();
/** Only topology facts are shared; reconstructed values and slope limits are channel-local. */
export function adaptivePatchGeometry(t: AdaptiveTopology) {
  if (!preparations.has(t)) preparations.set(t, prepare(t));
  return preparations.get(t)!;
}
