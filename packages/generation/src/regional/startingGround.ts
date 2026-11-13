import { fieldSampleIndex } from "@atlas/domain";
import { cutShare, resolveCut } from "../rock/groundShares";
import { nativePosition, parentChannels } from "../world/atlasWorkspace";
import { restoreFeatures } from "./causes/registry";
import { isContent } from "./lattice";
import { directionalResistance } from "./material";
import { valleyOrder, valleyScratch, valleyShares } from "./valleyPlacement";
import { reachAt } from "../water/riverKeeping";
import { updateSlopes } from "./relief";
import { realizeColumns } from "./columns";
import { physicalContext } from "../world/context";
import type { RegionalState, ReliefWork } from "./state";

/**
 * A region's starting ground is its parent's ground. A parent cell is a rough average of the
 * country inside it, and its rock column says what that country is like: how much of it is
 * valley, and how deep the valleys lie below the ground beside them. Every finer cell inherits
 * that record. Captured river courses locate the valley first; elsewhere the finer drainage
 * locates its floor. A narrow floor can occupy part of every course cell. Those cells take the
 * recorded floor and the rest stand at the uncut surface.
 *
 * No height is built up from a formula, nothing is fitted to the parent, and no edge is
 * pinned. Ground a parent recorded no valley in starts exactly as the parent's surface.
 * Later rounds work this ground through the shared processes.
 */
export function startGround(state: RegionalState) {
  // owner-direction(2026-11-12): a region starts at the parent's level and gets more defined; the parent's elevation is not thrown away.
  placeInheritedValleys(state);
  realizeColumns(state);
  delete state.regional.contacts;
  const network = state.regional.network!,
    basin = new Uint8Array(state.physical.map.mesh.count);
  for (let i = 0; i < basin.length; i++) if (network.lake[i] >= 0 || network.bowl[i]) basin[i] = 1;
  const relief: ReliefWork = { basin };
  state.regional.relief = relief;
  // Established landmarks restore their signatures on the ground.
  restoreFeatures(state);
  updateSlopes(state);
}

/** This map's land cells that inherited a valley, gathered by the parent cell each came from. */
function byParentCell(state: RegionalState) {
  const work = state.physical,
    map = work.map,
    donor = parentChannels(state).get("RockLayerKind0") ?? state.surface,
    groups = new Map<number, number[]>();
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!isContent(map.mesh, cell) || map.WaterKindCodes.get(cell) === 1) continue;
    if (cutShare(map, cell) <= 0) continue;
    const parent = fieldSampleIndex(donor, nativePosition(work, cell)),
      held = groups.get(parent);
    if (held) held.push(cell);
    else groups.set(parent, [cell]);
  }
  return groups;
}
/**
 * One parent cell's finer cells in the order a valley takes them: first the stream that
 * gathers most of the region's drainage through the parent cell, from where it enters to
 * where it leaves. Material responses choose how its connected floor widens from there.
 */
function streamCells(state: RegionalState, cells: readonly number[]) {
  const { area, receiver } = state.regional.network!,
    inside = new Set(cells),
    steps = new Set<number>();
  // The stream: the cell gathering most, the cells it runs on to, and its greatest feeders.
  const most = cells.reduce((best, cell) => (area[cell] > area[best] ? cell : best), cells[0]);
  for (let cell = most; inside.has(cell) && !steps.has(cell); cell = receiver[cell])
    steps.add(cell);
  for (let cell = most; ;) {
    const feeder = cells
      .filter((other) => receiver[other] === cell && !steps.has(other))
      .reduce((best, other) => (best < 0 || area[other] > area[best] ? other : best), -1);
    if (feeder < 0) break;
    steps.add(feeder);
    cell = feeder;
  }
  return [...steps];
}
/**
 * Shares each parent cell's valley among its finer cells: its retained course first, then
 * through yielding faces. Grain and exposed contacts decide which shoulders remain.
 */
export function placeInheritedValleys(state: RegionalState) {
  const map = state.physical.map,
    context = physicalContext(state.regional.input.seed, 0, state.physical.profile),
    scratch = valleyScratch(map.mesh.count);
  for (const cells of byParentCell(state).values()) {
    const whole = cells.reduce((sum, cell) => sum + map.mesh.area(cell), 0),
      retained = cells.filter((cell) => reachAt(map, cell)),
      seeds = retained.length ? retained : streamCells(state, cells);
    const order = valleyOrder(
      map.mesh,
      cells,
      seeds,
      (from, toward) => directionalResistance(map, from, toward, context),
      scratch
    );
    const shares = valleyShares(order, seeds.length, cutShare(map, cells[0]) * whole, (cell) =>
      map.mesh.area(cell)
    );
    order.forEach((cell, at) => resolveCut(map, cell, shares[at]));
  }
}
