import { standGround } from "../rock/groundLedger";
import { clearWaterSurface } from "../world/field";
import { units } from "../world/math";
import { meshWindowCells } from "../world/meshWindow";
import { neighborhood, neighborhoodCapacity } from "./lattice";
import { poolDepth } from "./base";
import type { RegionalState } from "./state";

/**
 * Standing water works its own shore. Narrow arms silt up first, since every stream entering
 * one drops its load there with no room to spread it, and waves cut the low ground around open
 * water back into a smooth curve. Together they leave a lake rounder than the valley it filled.
 */
/** How far an arm reaches from a lake's centre before it silts up, as a share of the lake's radius. */
const armReach = 1.25;
/** How far from its centre a lake's waves cut the shore, as a share of its radius. */
const shoreReach = 0.9;
/** The highest ground above its water, in metres, that a lake's waves can cut away. */
const cutHeight = 60;
/** Metres silted ground stands over the water it replaced. */
const siltRise = 1;

function bodiesOf(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    bodies = new Map<number, number[]>();
  for (let cell = 0; cell < mesh.count; cell++) {
    if (mesh.membership(cell) !== 1 || map.WaterKindCodes.get(cell) !== 2) continue;
    const body = map.WaterBodyIds.get(cell),
      cells = bodies.get(body);
    if (cells) cells.push(cell);
    else bodies.set(body, [cell]);
  }
  return bodies;
}
function setGround(state: RegionalState, cell: number, value: number) {
  standGround(state.physical.map, cell, value, "regional");
}
/** The centre of a lake's water and the radius of a circle of its area. */
function circleOf(state: RegionalState, cells: readonly number[]) {
  const mesh = state.physical.map.mesh;
  let area = 0,
    x = 0,
    y = 0;
  for (const cell of cells) {
    const a = mesh.contentArea(cell);
    area += a;
    x += mesh.x(cell) * a;
    y += mesh.y(cell) * a;
  }
  return { x: x / area, y: y / area, radius: Math.sqrt(area / Math.PI) };
}
function siltArms(
  state: RegionalState,
  cells: readonly number[],
  circle: ReturnType<typeof circleOf>,
  stage: number
) {
  const map = state.physical.map,
    mesh = map.mesh;
  for (const cell of cells) {
    if (Math.hypot(mesh.x(cell) - circle.x, mesh.y(cell) - circle.y) <= armReach * circle.radius)
      continue;
    setGround(state, cell, Math.max(map.Elevation.get(cell), stage + units(siltRise)));
    map.WaterKindCodes.set(cell, 0);
    map.WaterBodyIds.set(cell, 0);
    clearWaterSurface(map, cell);
  }
}
function cutShore(
  state: RegionalState,
  body: number,
  circle: ReturnType<typeof circleOf>,
  stage: number
) {
  const map = state.physical.map,
    mesh = map.mesh,
    reach = shoreReach * circle.radius,
    floor = stage - units(poolDepth + 1);
  for (const cell of meshWindowCells(mesh, [
    circle.x - reach,
    circle.y - reach,
    circle.x + reach,
    circle.y + reach,
  ])) {
    if (
      mesh.membership(cell) !== 1 ||
      map.WaterKindCodes.get(cell) !== 0 ||
      map.Elevation.get(cell) - stage > units(cutHeight) ||
      Math.hypot(mesh.x(cell) - circle.x, mesh.y(cell) - circle.y) > reach
    )
      continue;
    setGround(state, cell, Math.min(map.Elevation.get(cell), floor));
    map.WaterKindCodes.set(cell, 2);
    map.WaterBodyIds.set(cell, body);
    map.WaterDepths.set(cell, stage - map.Elevation.get(cell));
    map.WaterSurfaceElevations.set(cell, stage);
  }
}
/** Each lake's shore as its water leaves it: arms silted up, low ground cut back. */
export function roundLakes(state: RegionalState) {
  const map = state.physical.map;
  for (const [body, cells] of bodiesOf(state)) {
    const stage = map.WaterSurfaceElevations.get(cells[0]),
      circle = circleOf(state, cells);
    siltArms(state, cells, circle, stage);
    cutShore(state, body, circle, stage);
  }
}

/** The lake each cell's water reaches first, by body; 0 where it reaches none. */
function firstLakes(state: RegionalState) {
  const map = state.physical.map,
    { receiver, order, count } = state.regional.drainage!,
    first = new Int32Array(map.mesh.count);
  for (let k = 0; k < count; k++) {
    const i = order[k];
    first[i] =
      map.WaterKindCodes.get(i) === 2
        ? map.WaterBodyIds.get(i)
        : receiver[i] >= 0
          ? first[receiver[i]]
          : 0;
  }
  return first;
}
/**
 * Water beside the lake it is bound for goes in. A route found on the flooded surface can run
 * along the shore to where the fill happened to reach the lake; nothing would hold a stream
 * off open water beside it. Water leaving a lake is bound for another, so it stays its course.
 */
export function riversIntoLakes(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    graph = state.regional.drainage!,
    first = firstLakes(state),
    rank = new Int32Array(mesh.count).fill(-1),
    around = new Int32Array(neighborhoodCapacity);
  for (let k = 0; k < graph.count; k++) rank[graph.order[k]] = k;
  for (let k = 0; k < graph.count; k++) {
    const i = graph.order[k];
    if (!first[i] || map.WaterKindCodes.get(i) === 2) continue;
    const m = neighborhood(mesh, i, around);
    for (let n = 0; n < m; n++) {
      const j = around[n];
      if (map.WaterBodyIds.get(j) === first[i] && rank[j] >= 0 && rank[j] < k) {
        graph.receiver[i] = j;
        break;
      }
    }
  }
}
