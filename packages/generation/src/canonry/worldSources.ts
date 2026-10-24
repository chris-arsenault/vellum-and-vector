import type { PhysicalMesh } from "./mesh";
import { hashUnit } from "./noise";

export interface WorldCandidate {
  id: number;
  x: number;
  y: number;
  priority: number;
}
export const coordinateKey = (x: number, y: number) => `${x.toFixed(6)}:${y.toFixed(6)}`;

/** Candidate identities and positions depend on the physical domain, never its mesh. */
export function worldCandidates(mesh: PhysicalMesh, seed: number, count: number): WorldCandidate[] {
  const [x0, y0, x1, y1] = mesh.bounds;
  return Array.from({ length: count }, (_, id) => ({
    id,
    x: x0 + (x1 - x0) * hashUnit(seed ^ 0x1b73, id, 0),
    y: y0 + (y1 - y0) * hashUnit(seed ^ 0x2db9, id, 1),
    priority: hashUnit(seed ^ 0x4a91, id, 2),
  }));
}

export function separatedCandidates(candidates: WorldCandidate[], count: number, spacing: number) {
  const selected: WorldCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (selected.every((p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) >= spacing))
      selected.push(candidate);
  }
  return selected;
}
