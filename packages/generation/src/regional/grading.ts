import { deposit, erode } from "../rock/groundLedger";
import { loadOf } from "../rock/groundLoad";
import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import type { MaterialLayer } from "../rock/rockColumn";
import { units } from "../world/math";
import { onRiver } from "../water/riverKeeping";
import { distance, isContent, neighborsOf, regionalSpan } from "./lattice";
import type { RegionalState, Seat } from "./state";

/**
 * People level the ground they build on after amplification, slides and the sea
 * have acted on the written surface. Inside each seat's footprint
 * every step between neighbours steeper than the seat's gradient is relaxed by moving both
 * sides toward each other (cut above, fill below), so a seat on a scarp stands on a bench cut
 * into it and the scarp's drop gathers at the footprint's edge. Water and river channels are
 * not moved: a town is never graded across its own river.
 */
export function gradeSeats(state: RegionalState) {
  for (const seat of state.regional.evidence?.seats ?? []) gradeSeat(state, seat);
}

export function gradeSeat(state: RegionalState, seat: Seat) {
  gradeGround(state, new Map(footprint(state, seat).map((cell) => [cell, seat.gradient])));
}

/** How close to its grade a step is brought, as a share of the step the grade allows. */
const gradeSlack = 0.05;
/** Feature footprints request a grade; their cut material supplies the fill. */
export function gradeGround(state: RegionalState, targets: ReadonlyMap<number, number>) {
  const map = state.physical.map,
    cells = [...targets.keys()].filter(
      (cell) => isContent(map.mesh, cell) && map.WaterKindCodes.get(cell) === 0
    ),
    inside = new Map(cells.map((cell, k) => [cell, k])),
    h = cells.map((i) => map.Elevation.get(i)),
    areas = cells.map((i) => map.mesh.area(i)),
    network = state.regional.network,
    basin = state.regional.relief?.basin,
    // This round's channels and kept hollows, and the last routing's rivers, stay as they are.
    movable = cells.map((i) => !onRiver(map, i) && !network?.channel[i] && !basin?.[i]),
    edges = gradeEdges(state, targets, cells, inside),
    // A graded step is good to a share of the step it is held to: nobody levels ground to a
    // millimetre, and asking for that kept large or steep footprints relaxing without end.
    tolerance = edges.reduce((least, edge) => Math.min(least, edge[2] * gradeSlack), Infinity);
  while (gradeRound(h, movable, areas, edges, Math.max(1, tolerance))) {
    // Resolve achievable grading until a complete pass moves nothing by more than the slack.
  }
  placeGrade(map, cells, h);
}

/** Excavation leaves real load; fills draw those material snapshots without inventing supply. */
function placeGrade(map: PhysicalField, cells: number[], heights: number[]) {
  const parcels: { cell: number; material: MaterialLayer }[] = [];
  cells.forEach((cell, at) => {
    const cut = map.Elevation.get(cell) - heights[at];
    if (cut <= 0) return;
    erode(map, cell, cut, "regional", "load", (material) =>
      parcels.push({
        cell,
        material: {
          ...material,
          depth: MapScale.metres(material.depth, "native") * map.mesh.area(cell),
        },
      })
    );
  });
  fillGrade(map, cells, heights, parcels);
  for (const { cell, material } of parcels) loadOf(map).add(cell, material);
}

/** Parcel depths here are volumes, as in Ground's sediment load. */
function fillGrade(
  map: PhysicalField,
  cells: number[],
  heights: number[],
  parcels: { cell: number; material: MaterialLayer }[]
) {
  let donor = 0;
  cells.forEach((cell, at) => {
    let fill = Math.max(0, heights[at] - map.Elevation.get(cell));
    while (fill > 0 && donor < parcels.length) {
      const material = parcels[donor].material,
        volume = Math.min(material.depth, MapScale.metres(fill, "native") * map.mesh.area(cell)),
        depth = MapScale.inUnits(volume / map.mesh.area(cell), "native"),
        placed = deposit(map, cell, depth, "regional", "load", { ...material, depth });
      const remaining = material.depth - MapScale.metres(placed, "native") * map.mesh.area(cell);
      parcels[donor].material = { ...material, depth: remaining };
      fill -= placed;
      if (remaining <= 0 || placed <= 0) donor++;
    }
  });
}

/** The seat's land cells within its footprint reach. */
function footprint(state: RegionalState, seat: Seat) {
  const map = state.physical.map,
    mesh = map.mesh,
    reach = (seat.radius + 0.5) * regionalSpan(state),
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++)
    if (
      isContent(mesh, i) &&
      map.WaterKindCodes.get(i) === 0 &&
      distance(mesh, seat.cell, i) <= reach
    )
      cells.push(i);
  return cells;
}

type GradeEdge = readonly [number, number, number];
/** Each neighboring pair carries the footprint's requested physical grade. */
function gradeEdges(
  state: RegionalState,
  targets: ReadonlyMap<number, number>,
  cells: number[],
  inside: Map<number, number>
) {
  const mesh = state.physical.map.mesh,
    around = new Int32Array(mesh.stride),
    edges: GradeEdge[] = [];
  cells.forEach((i, a) => {
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const b = inside.get(around[k]);
      if (b === undefined || b <= a) continue;
      const gradient = Math.min(targets.get(i)!, targets.get(around[k])!);
      edges.push([a, b, units(gradient * distance(mesh, i, around[k]))]);
    }
  });
  return edges;
}

/** Average simultaneous face corrections so incompatible protected edges can settle. */
export function gradeRound(
  h: number[],
  movable: boolean[],
  areas: number[],
  edges: readonly GradeEdge[],
  tolerance = 1
) {
  const changes = new Float64Array(h.length),
    counts = new Uint32Array(h.length);
  for (const [a, b, limit] of edges) {
    const pair = [h[a], h[b]];
    gradePair(pair, [movable[a], movable[b]], 0, 1, limit, [areas[a], areas[b]], tolerance);
    changes[a] += pair[0] - h[a];
    changes[b] += pair[1] - h[b];
    counts[a]++;
    counts[b]++;
  }
  let moved = false;
  for (let i = 0; i < h.length; i++) {
    const before = h[i];
    if (counts[i] > 0) h[i] += changes[i] / counts[i];
    moved = Math.abs(h[i] - before) > tolerance || moved;
  }
  return moved;
}

/** Bring the pair's step down to `limit`, sharing the change between the sides that move. */
export function gradePair(
  h: number[],
  movable: boolean[],
  a: number,
  b: number,
  limit: number,
  areas: number[],
  tolerance: number
) {
  const step = h[a] - h[b],
    excess = Math.abs(step) - limit;
  if (excess <= tolerance || (!movable[a] && !movable[b])) return false;
  const beforeA = h[a],
    beforeB = h[b],
    toward = Math.sign(step) * excess,
    both = movable[a] && movable[b],
    total = areas[a] + areas[b];
  if (movable[a]) h[a] -= toward * (both ? areas[b] / total : 1);
  if (movable[b]) h[b] += toward * (both ? areas[a] / total : 1);
  return h[a] !== beforeA || h[b] !== beforeB;
}
