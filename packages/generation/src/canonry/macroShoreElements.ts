import type { Position } from "@atlas/domain";

type Water = (p: Position) => {kind: number; level: number};
/** Split final numeric elements at a shared shore, prescribing its water level. */
export function shoreElementWriter(positions: number[], channels: Record<string, number[]>,
  elements: number[], water: Water, categories = new Set<string>()) {
  const crossing = new Map<string, number>(), flags: boolean[] = [],
    at = (i: number): Position => ({x: positions[i * 2], y: positions[i * 2 + 1], z: 0}),
    wet = (i: number) => {
      if (flags[i] === undefined) flags[i] = water(at(i)).kind > 0;
      return flags[i];
    };
  const boundary = (a: number, b: number) => {
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (crossing.has(key)) return crossing.get(key)!;
    const left = at(a), right = at(b), first = water(left), second = water(right),
      level = first.kind > 0 ? first.level : second.level,
      t = shoreFraction(left, right, first.kind > 0, water),
      index = positions.length / 2;
    positions.push(left.x + (right.x - left.x) * t, left.y + (right.y - left.y) * t);
    for (const [name, values] of Object.entries(channels))
      values.push(categories.has(name) ? values[t < 0.5 ? a : b] : values[a] * (1 - t) + values[b] * t);
    const old = channels.elevation[index];
    channels.elevation[index] = level;
    channels.bedrock[index] += level - old;
    crossing.set(key, index);
    return index;
  };
  return (vertices: number[]) => {
    const flags = vertices.map(wet);
    if (flags.every((v) => v === flags[0])) {elements.push(...vertices); return;}
    for (const keep of [false, true]) {
      const polygon = clipElement(vertices, flags, keep, boundary);
      for (let i = 1; i < polygon.length - 1; i++)
        elements.push(polygon[0], polygon[i], polygon[i + 1], polygon[i + 1]);
    }
  };
}
function clipElement(vertices: number[], flags: boolean[], keep: boolean,
  boundary: (a: number, b: number) => number) {
  const polygon: number[] = [];
  for (let n = 0; n < vertices.length; n++) {
    const previous = (n + vertices.length - 1) % vertices.length;
    if (flags[n] !== flags[previous]) polygon.push(boundary(vertices[previous], vertices[n]));
    if (flags[n] === keep) polygon.push(vertices[n]);
  }
  return polygon;
}
function shoreFraction(a: Position, b: Position, firstWet: boolean, water: Water) {
  let low = 0, high = 1;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  while ((high - low) * length > 0.1) {
    const middle = (low + high) / 2,
      p = {x: a.x + (b.x - a.x) * middle, y: a.y + (b.y - a.y) * middle, z: 0};
    if ((water(p).kind > 0) === firstWet) low = middle; else high = middle;
  }
  return (low + high) / 2;
}
