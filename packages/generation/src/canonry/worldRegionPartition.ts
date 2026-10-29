import { KeyedHeap } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { RegionMembers } from "./regionMembers";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { regionEvidence } from "./worldRegionEvidence";
import { largeWorldDomain, landscapeMinimumBreadth } from "../worldSignificance";

/** Cross-basin travel is harder than movement along the same broad drainage structure. */
const basinCrossingCost = 2;
/** Elevation changes across a face organize provinces around major relief barriers. */
const terrainRiseScale = 600;
/** A broad climate transition can separate two parts of an otherwise continuous forest. */
const climateTransitionScale = 60;
/** Reject a subdivision that cuts a sliver off a larger geographic body. */
const provinceMinimumShare = 0.18;

function crossingCost(map: PhysicalField, i: number, j: number, length: number) {
  const basin = map.DrainageBasinIds.get(i),
    other = map.DrainageBasinIds.get(j),
    divide = basin > 0 && other > 0 && basin !== other ? basinCrossingCost : 0,
    rise = Math.abs(map.Elevation.get(i) - map.Elevation.get(j)) / 1024,
    climate = Math.abs(map.Temperature.get(i) - map.Temperature.get(j));
  return length * (1 + divide + rise / terrainRiseScale + climate / climateTransitionScale);
}

/** Distances stay inside a landscape and respond to its physical barriers. */
function provinceDistances(map: PhysicalField, members: RegionMembers, seeds: number[]) {
  const distance = workingArray(map, "float64", "province:distance").fill(-1),
    owner = workingArray(map, "int32", "province:owner").fill(-1),
    queue = new KeyedHeap("min");
  for (const i of members) distance.set(i, Infinity);
  seeds.forEach((cell, index) => {
    distance.set(cell, 0);
    owner.set(cell, index);
    queue.push(cell, 0);
  });
  const mesh = map.mesh;
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const d = queue.poppedKey();
    if (distance.get(i) !== d) continue;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0 || distance.get(j) < 0) continue;
      const next = d + crossingCost(map, i, j, mesh.edgeLength(i, edge));
      if (next >= distance.get(j)) continue;
      distance.set(j, next);
      owner.set(j, owner.get(i));
      queue.push(j, next);
    }
  }
  return { distance, owner };
}
function distantAnchor(map: PhysicalField, members: RegionMembers, start: number) {
  const { distance, owner } = provinceDistances(map, members, [start]);
  const far = members.reduce((best, i) => (distance.get(i) > distance.get(best) ? i : best), start);
  releaseWorking(map, distance, owner);
  return far;
}

/**
 * Continental domains divide around distant geographic anchors. Terrain, climate and
 * drainage steer the frontier; distance provides broad provinces even on quiet plains.
 * Every child is substantial, connected by the same search, and judged again before use.
 */
export function partitionWorldRegion(state: GenerationState, members: RegionMembers, land: number) {
  const map = state.physical!.map,
    pending = [members instanceof Int32Array ? members : Int32Array.from(members)],
    result: Int32Array[] = [];
  while (pending.length) {
    const current = pending.pop()!,
      evidence = regionEvidence(map, current);
    if (!largeWorldDomain(evidence.area, evidence.span, land)) {
      result.push(current);
      continue;
    }
    const a = distantAnchor(map, current, current[0]),
      b = distantAnchor(map, current, a),
      { owner, distance } = provinceDistances(map, current, [a, b]);
    const pieces = [
      current.filter((i) => owner.get(i) === 0),
      current.filter((i) => owner.get(i) === 1),
    ];
    releaseWorking(map, owner, distance);
    const credible = pieces.every((piece) => {
      if (!piece.length) return false;
      const e = regionEvidence(map, piece);
      return e.area >= evidence.area * provinceMinimumShare && e.breadth >= landscapeMinimumBreadth;
    });
    if (credible) pending.push(...pieces);
    else {
      result.push(current);
      (state.diagnostics ??= []).push({
        code: "world_domain_subdivision",
        severity: "warning",
        message:
          "A continental region has no substantial connected division under the current geographic evidence.",
        resource: state.domain.scope.areaId,
        invocation: null,
        process: "canonry.geographic-extraction",
        epochs: [],
        outcome: "retained",
      });
    }
  }
  return result;
}
