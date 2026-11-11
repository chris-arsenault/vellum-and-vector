import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField, MagicWorkspace } from "./magicState";
import type { LocateContext } from "./magicSources";
import { nativeIndexAtSurface } from "./atlasWorkspace";
import { siteStrength } from "./magicStocks";
import { alterRock } from "../rock/rockField";
import { clamp, round } from "./math";
import { CellQueue, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { metricSearch } from "./metricSearch";
import { meshDeltaX } from "./mesh";

const wards = (field: MagicField) =>
  field.definition.enabled && field.definition.effects.warding > 0;
/** The least strength a kept line or a pilgrimage road has; a fainter way is only a track. */
const lineFloor = 100;
/** Warding from which a ward seals a cell: a conduit does not enter, a door does not hold. */
export const wardSeals = 0.5;

/**
 * Hallowed's seats: an inhabited seat kept past the source floor of the full tenure is a
 * source, stronger by a bonus for every way that converges on it (the pilgrimage). A young
 * town is no seat. The ring a seat wards reaches in proportion to its strength.
 */
export function tenureSources(
  state: GenerationState,
  field: MagicField,
  _seed: number,
  { origin }: LocateContext
) {
  const society = maintainedSociety(state);
  if (!society) return;
  const map = state.physical!.map,
    p = field.definition.parameters,
    ways = waysConverging(society.connections);
  for (const c of society.communities) {
    if (c.status !== "inhabited") continue;
    const cell = nativeIndexAtSurface(state, c.position.x, c.position.y);
    if (cell < 0 || map.Tenure.get(cell) <= 0) continue;
    // A seat is a point fact: its person-years count whole, whatever the cell's size.
    const tenure = map.Tenure.get(cell) / p.tenureFull,
      strength = siteStrength(1000 * tenure * (1 + p.pilgrimageBonus * (ways.get(c.id) ?? 0)));
    if (strength === 0) continue;
    field.source.set(cell, Math.max(field.source.get(cell), strength));
    field.located.push({
      origin: origin.id,
      id: `seat:${c.id}`,
      x: map.mesh.x(cell),
      y: map.mesh.y(cell),
      radius: (p.wardReach * strength) / 1000,
      strength,
    });
  }
}
function maintainedSociety(state: GenerationState) {
  return (
    state.society?.region ??
    (state.physical?.inherited
      ? state.domain.world.societies?.[state.domain.scope.areaId]
      : undefined)
  );
}
/** How many ways end at each community. */
function waysConverging(connections: { from: string; to: string }[]) {
  const ways = new Map<string, number>();
  for (const link of connections) {
    ways.set(link.from, (ways.get(link.from) ?? 0) + 1);
    ways.set(link.to, (ways.get(link.to) ?? 0) + 1);
  }
  return ways;
}
/** Hallowed's lines: kept-years where people keep a frontier or a work, and the roads pilgrims wear. */
export function keptLineSources(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    // A line is a line whatever cell it crosses: kept-years and traveller-years count whole.
    // Below a tenth of a full line a track is only a track: without the floor every path a
    // world has walked wards the land a little, and nothing else is itself anywhere.
    const kept = map.KeptLine.get(i) / p.lineFull,
      road = map.WalkedRoute.get(i) / p.roadFull,
      strength = clamp(round(1000 * Math.max(kept, road)), 0, 1000);
    if (strength >= lineFloor) field.source.set(i, strength);
  }
}
/**
 * The ward: a ring around each located seat falling to nothing at its reach, lines where
 * their sources lie; Aurora's stored charge adds where the two meet, and an open Fire
 * conduit breaks the ward at its cell.
 */
export function wardPropagation(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    magic = state.physical!.magic!,
    p = field.definition.parameters;
  field.intensity.copyFrom(field.source);
  for (const seat of field.located)
    for (let i = 0; i < map.mesh.count; i++) {
      const distance = Math.hypot(
        meshDeltaX(map.mesh, map.mesh.x(i) - seat.x),
        map.mesh.y(i) - seat.y
      );
      field.intensity.set(
        i,
        Math.max(
          field.intensity.get(i),
          seat.strength *
            Math.max(0, 1 - distance / Math.max(map.scale.length(0.00000025), seat.radius))
        )
      );
    }
  const others = magic.fields.filter((other) => other !== field && other.definition.enabled),
    stills = others.find((other) => other.definition.effects.stillness > 0),
    fire = others.find((other) => other.definition.effects.conduitOpening > 0);
  for (let i = 0; i < map.mesh.count; i++) {
    let intensity = field.intensity.get(i);
    if (intensity <= 0) continue;
    // Held charge reinforces a ward in proportion to the ward that is there to reinforce.
    if (stills) intensity += p.auroraReinforce * stills.stored.get(i) * (intensity / 1000);
    if (fire && fire.source.get(i) > 0) intensity = 0;
    field.intensity.set(i, Math.min(1000, intensity));
  }
}
/**
 * Warding, applied once at the end of every other system's propagation: inside a ring the
 * intensity is scaled down by the warding, and what was removed, by area, lands on the rim
 * cells, so the ground just outside a sanctuary is the most dangerous in the world.
 */
export function applyWarding(state: GenerationState, field: MagicField) {
  const map = state.physical!.map,
    magic = state.physical!.magic;
  if (!magic || wards(field) || !magic.fields.some(wards)) return;
  const displaced = removeInside(map, magic, (i) => field.intensity.get(i) * map.Warding.get(i));
  landOnRim(
    map,
    magic,
    displaced,
    (i, added) => {
      field.intensity.set(i, clamp(round(field.intensity.get(i) + added), 0, 1000));
    },
    (i) => acceptsRim(map, field, i),
    (i, area) =>
      field.intensity.set(i, wardedIntensity(field.intensity.get(i), map.Warding.get(i), area))
  );
}
/** A ward redirects activity only when its ring has a receiver in the correct medium. */
export const wardedIntensity = (value: number, warding: number, receiverArea: number) =>
  receiverArea > 0 ? round(value * (1 - warding)) : value;
/** Displacement preserves the receiving medium of the system's actual propagation. */
function acceptsRim(map: PhysicalField, field: MagicField, i: number) {
  if (field.definition.origins.some((origin) => origin.propagation === "ocean-rays"))
    return map.WaterKindCodes.get(i) === 1;
  if (field.definition.origins.some((origin) => origin.propagation === "roots"))
    return (
      map.WaterKindCodes.get(i) === 0 &&
      map.IceThickness.get(i) <= 0 &&
      map.TreeCover.get(i) + map.GrassCover.get(i) + map.WetlandCover.get(i) > 0
    );
  return map.WaterKindCodes.get(i) !== 1;
}
/** What each ring removes, as an amount per ring: the removed value times the cell's area. */
function removeInside(map: PhysicalField, magic: MagicWorkspace, removed: (i: number) => number) {
  const displaced = workingArray(map, "float64", "magic:ward-displacement");
  for (let i = 0; i < map.mesh.count; i++) {
    const ring = magic.wardLabel.get(i);
    if (ring < 0) continue;
    displaced.add(ring, removed(i) * map.mesh.area(i));
  }
  return displaced;
}
/** Lay each ring's amount on that ring's own rim cells, by their area. */
function landOnRim(
  map: PhysicalField,
  magic: MagicWorkspace,
  displaced: Band,
  land: (i: number, added: number) => void,
  accepts: (i: number) => boolean = () => true,
  withdraw?: (i: number, receiverArea: number) => void
) {
  const rimArea = receivingRimArea(map, magic, accepts);
  for (let i = 0; i < map.mesh.count; i++) {
    const sourceRing = magic.wardLabel.get(i);
    if (sourceRing >= 0) withdraw?.(i, rimArea.get(sourceRing));
    const ring = magic.rimLabel.get(i);
    if (ring < 0 || !accepts(i)) continue;
    const amount = displaced.get(ring),
      area = rimArea.get(ring);
    if (amount > 0 && area > 0) land(i, (amount / area) * magic.wardRim.get(i));
  }
  releaseWorking(map, displaced, rimArea);
}
function receivingRimArea(
  map: PhysicalField,
  magic: MagicWorkspace,
  accepts: (i: number) => boolean
) {
  const area = workingArray(map, "float64", "magic:ward-rim-area");
  for (let i = 0; i < map.mesh.count; i++) {
    const ring = magic.rimLabel.get(i);
    if (ring >= 0 && accepts(i)) area.add(ring, map.mesh.area(i) * magic.wardRim.get(i));
  }
  return area;
}
/**
 * The rings and their rims: every connected patch of warding is one ring, and a cell with
 * no warding within the geographic rim width receives its displaced activity. Partial
 * cells represent a narrow rim at coarse resolution; refining does not change its width.
 */
export function markRim(map: PhysicalField, magic: MagicWorkspace) {
  const { mesh } = map;
  magic.wardRim.fill(0);
  magic.wardLabel.fill(-1);
  magic.rimLabel.fill(-1);
  const queue = new CellQueue();
  let rings = 0;
  for (let start = 0; start < mesh.count; start++) {
    if (map.Warding.get(start) <= 0 || magic.wardLabel.get(start) >= 0) continue;
    labelRing(map, magic, start, rings, queue);
    rings++;
  }
  spreadRims(map, magic);
}
/** Rim width follows the map's geographic scale, while overlap uses each sample's footprint. */
function spreadRims(map: PhysicalField, magic: MagicWorkspace) {
  const distance = workingArray(map, "float64", "magic:rim-distance").fill(Infinity),
    width = map.scale.length(0.00125);
  function* seeds() {
    for (let i = 0; i < map.mesh.count; i++)
      if (magic.wardLabel.get(i) >= 0) {
        distance.set(i, 0);
        magic.rimLabel.set(i, magic.wardLabel.get(i));
        yield i;
      }
  }
  metricSearch(map.mesh, seeds(), distance, width + map.mesh.spacing, (j, i) =>
    magic.rimLabel.set(j, magic.rimLabel.get(i))
  );
  for (let i = 0; i < map.mesh.count; i++) {
    const fraction =
      map.Warding.get(i) > 0 ? 0 : rimFraction(distance.get(i), width, Math.sqrt(map.mesh.area(i)));
    magic.wardRim.set(i, fraction);
    if (fraction <= 0) magic.rimLabel.set(i, -1);
  }
  releaseWorking(map, distance);
}
export const rimFraction = (distance: number, width: number, sampleSpan: number) =>
  clamp((width + sampleSpan - distance) / sampleSpan, 0, Math.min(1, width / sampleSpan));
/** Flood one ring from a warded cell, marking its cells and the rim cells around it. */
function labelRing(
  map: PhysicalField,
  magic: MagicWorkspace,
  start: number,
  ring: number,
  queue: CellQueue
) {
  const { mesh } = map;
  queue.clear();
  queue.push(start);
  magic.wardLabel.set(start, ring);
  for (let i = queue.shift(); i >= 0; i = queue.shift()) {
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j < 0) continue;
      if (map.Warding.get(j) > 0 && magic.wardLabel.get(j) < 0) {
        magic.wardLabel.set(j, ring);
        queue.push(j);
      }
    }
  }
}
/**
 * What the ward holds back is not destroyed. The storm energy on the tracks inside lands on
 * the rim's storm forcing, and where a channel leaves the ring the first reach below loses
 * the resistance the ring gained, so the sediment held back cuts there.
 */
export function hallowedWrites(state: GenerationState) {
  const map = state.physical!.map,
    magic = state.physical!.magic!,
    fields = magic.fields.filter(wards);
  if (!fields.length) return;
  const storm = removeInside(map, magic, (i) => map.StormTrack.get(i) * map.Warding.get(i));
  landOnRim(map, magic, storm, (i, added) => {
    map.StormForcing.set(i, clamp(round(map.StormForcing.get(i) + added), 0, 1000));
  });
  for (const field of fields) spillBelow(map, field);
}
function spillBelow(map: PhysicalField, field: MagicField) {
  const spill = field.definition.parameters.wardSpill;
  for (let i = 0; i < map.mesh.count; i++) {
    const w = map.Warding.get(i),
      target = map.FlowTargets.get(i);
    if (w <= 0 || target < 0 || map.Warding.get(target) > 0 || map.WaterKindCodes.get(target) !== 0)
      continue;
    alterRock(map, target, -round(spill * w));
  }
}
/**
 * Coasts hold inside a ward: the external forcing on a warded shore moves to the shore
 * downdrift of it, along the current of the sea beside it, as past a terminal groyne.
 */
export function wardCoasts(map: PhysicalField, magic: MagicWorkspace, totals: Band) {
  if (!magic.fields.some(wards)) return;
  const moved = workingArray(map, "float64", "magic:ward-coasts");
  for (let i = 0; i < map.mesh.count; i++) {
    const w = map.Warding.get(i),
      total = totals.get(i);
    if (w <= 0 || map.WaterKindCodes.get(i) !== 0 || total <= 0) continue;
    const taken = round(total * w);
    const target = downdrift(map, i);
    if (target >= 0) {
      totals.set(i, total - taken);
      moved.add(target, taken);
    }
  }
  for (let i = 0; i < map.mesh.count; i++) {
    const added = moved.get(i);
    if (added > 0) totals.set(i, clamp(totals.get(i) + round(added), 0, 1000));
  }
  releaseWorking(map, moved);
}
/** The land neighbour that lies along the strongest current of the sea beside a shore cell. */
function downdrift(map: PhysicalField, i: number) {
  let dx = 0,
    dy = 0,
    strength = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0 || map.WaterKindCodes.get(j) !== 1 || map.OceanCurrentStrength.get(j) <= strength)
      continue;
    [dx, dy, strength] = [
      map.OceanCurrentX.get(j),
      map.OceanCurrentY.get(j),
      map.OceanCurrentStrength.get(j),
    ];
  }
  if (strength <= 0) return -1;
  let best = -1,
    score = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (!openShore(map, j)) continue;
    const alignment = map.mesh.edgeX(i, edge) * dx + map.mesh.edgeY(i, edge) * dy;
    if (alignment > score) [best, score] = [j, alignment];
  }
  return best;
}
const openShore = (map: PhysicalField, i: number) => {
  if (i < 0 || map.WaterKindCodes.get(i) !== 0 || map.Warding.get(i) > 0) return false;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) === 1) return true;
  }
  return false;
};
