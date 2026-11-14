import { riverDrop, waterfallLeastDrop } from "../../world/landforms";
import { hashUnit } from "../../world/noise";
import { hostedCell } from "../../area/areaHosting";
import type { GenerationState } from "../../process";
import type { RegionalState } from "../../regional/state";
import { mapScale, worldFallsDischarge, worldFallsDrop } from "../../worldSignificance";
import type { PoiFieldChange, PoiPlace, PoiVariety } from "../poiContract";
import { carriedPlaces } from "../poiPublish";
import {
  adjacent,
  dischargeAt,
  fieldOf,
  hardnessAt,
  hasChannel,
  isLand,
  jointedAt,
  toNative,
} from "../poiReads";
import { varietyOf } from "../poiVariety";
import { sized } from "../poiVisibilityRules";
import { bareOf, thinSoilOf } from "../relief/reliefShape";
import { fallForm, fallShapes, type FallForm } from "./waterfallForms";
import { trueFallSize, type TrueFallSize } from "./waterfallSize";
import { flowTarget } from "./waterReads";
import { runMemory } from "../../runMemory";

const salt = 0x7042;
const salts = { height: 0x7043, width: 0x7044 };
/** A crest this wide at the World's scale is known there, however low the fall, in metres. */
// length-unit: fraction
const worldFallsWidth = 0.000125;
export const dropOf = (state: GenerationState, place: PoiPlace) =>
  riverDrop(fieldOf(state), place.anchor);
export const dischargeOf = (state: GenerationState, place: PoiPlace) =>
  dischargeAt(state, place.anchor);

const sizes = (state: GenerationState) =>
  runMemory(state, "falls.true-size", () => new Map<string, TrueFallSize>());
/** What a parent's record says a carried fall at this cell really is. */
function carriedSize(state: GenerationState, cell: number): TrueFallSize | null {
  if (!("regional" in state)) return null;
  const found = carriedPlaces(state as RegionalState).find(
    ({ entry, carried }) => entry.id === "waterfall" && hostedCell(state, carried.feature) === cell
  );
  const attributes = found?.carried.feature.attributes,
    size = attributes?.trueSize as Omit<TrueFallSize, "members"> | undefined;
  return size ? { ...size, members: Number(attributes?.members ?? 1) } : null;
}
/** What a fall at this cell would really be, from the river's drop and chance. */
export function sizeAtCell(state: GenerationState, cell: number) {
  return trueFallSize(
    {
      budget: riverDrop(fieldOf(state), cell),
      discharge: dischargeAt(state, cell),
      fracture: jointedAt(state, cell),
    },
    hashUnit(salts.height, cell, 0),
    hashUnit(salts.width, cell, 0),
    fieldOf(state).scale
  );
}
/** What a fall really is, settled once: the ground its own step shapes does not choose again. */
export function sizeOfFall(state: GenerationState, place: PoiPlace) {
  const kept = sizes(state);
  let size = kept.get(place.id);
  if (!size) {
    size =
      (place.origin === "carried" ? carriedSize(state, place.anchor) : null) ??
      sizeAtCell(state, place.anchor);
    kept.set(place.id, size);
  }
  return size;
}
const heightOf = (state: GenerationState, place: PoiPlace) => sizeOfFall(state, place).height;
/** Whether a fall is known on this map: its real height or crest, at this map's scale. */
export function prominentFall(state: GenerationState, place: PoiPlace) {
  const { height, width } = sizeOfFall(state, place),
    scale = mapScale(state);
  return height >= scale.resolveMeasure(worldFallsDrop) || width >= scale.length(worldFallsWidth);
}

export const fallVariety: PoiVariety = {
  statement:
    "Rock and the river's own size weigh each form and chance picks among them: a great river makes a cataract, broken rock a cascade, a tall thin fall a ribbon, hard rock a plunge or a chute.",
  of(state, place) {
    const cell = place.anchor;
    return fallForm(
      {
        hardness: hardnessAt(state, cell),
        fracture: jointedAt(state, cell),
        tall: sized(heightOf, worldFallsDrop)(state, place),
        broad: sized(dischargeOf, worldFallsDischarge)(state, place),
      },
      hashUnit(salt, cell, 0)
    );
  },
};
export const formIn = (state: GenerationState, place: PoiPlace) =>
  varietyOf(state, fallVariety, place) as FallForm;

/**
 * The step in the long profile: the lip keeps its height and the ground below is held a whole
 * step beneath it, at least the least drop that falls, so erosion cannot smooth it away. A fall
 * into standing water has its step already: the water's surface is what it drops to.
 */
export function step(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const target = flowTarget(state, place.anchor),
    lip = fieldOf(state).Elevation.get(place.anchor);
  if (target < 0 || !isLand(state, place.anchor) || !isLand(state, target)) return [];
  const drop = Math.max(dropOf(state, place), waterfallLeastDrop(fieldOf(state)));
  return [
    { change: "atLeast", band: "Elevation", cell: place.anchor, value: lip },
    { change: "atMost", band: "Elevation", cell: target, value: lip - toNative(drop) },
  ];
}
/** The most a carried fall asks of finer ground, in metres, and how far down it may grade the bed. */
const largestCarriedDrop = 0.000025,
  carriedGrade = 40,
  /** What the bed falls per cell along the graded reach, in metres. */
  gradedFall = 0.000000125;
/**
 * The step a carried fall needs at its place on its river, whatever the ground there. The lip
 * holds and the bed below comes down, cell by cell until it meets ground already that low, so
 * the river still runs downhill below the fall.
 */
export function carriedStep(
  state: GenerationState,
  cell: number,
  parentDrop: number
): readonly PoiFieldChange[] {
  const map = fieldOf(state),
    lip = map.Elevation.get(cell),
    drop = Math.min(
      map.scale.length(largestCarriedDrop, 0.5),
      Math.max(parentDrop, waterfallLeastDrop(map))
    ),
    floor = lip - toNative(drop),
    below = reachBelow(
      state,
      { id: "", kind: "waterfall", cells: [cell], anchor: cell },
      carriedGrade
    );
  const changes: PoiFieldChange[] = [{ change: "atLeast", band: "Elevation", cell, value: lip }];
  for (let k = 1; k < below.length; k++) {
    const value = floor - toNative(map.scale.length(gradedFall, 0.5) * (k - 1));
    if (map.Elevation.get(below[k]) <= value) break;
    changes.push({ change: "atMost", band: "Elevation", cell: below[k], value });
  }
  return changes;
}
/** The river's cells from the lip downstream, as far as a form has worn back. */
function reachBelow(state: GenerationState, place: PoiPlace, length: number) {
  const reach = [place.anchor];
  while (reach.length < length) {
    const next = flowTarget(state, reach[reach.length - 1]);
    if (next < 0 || !isLand(state, next) || reach.includes(next)) break;
    reach.push(next);
  }
  return reach;
}
const isBank = (state: GenerationState, cell: number, reach: readonly number[]) =>
  isLand(state, cell) && !hasChannel(state, cell) && !reach.includes(cell);
const banksOf = (state: GenerationState, cell: number, reach: readonly number[]) =>
  [...adjacent(state, cell)].filter((near) => isBank(state, near, reach));

/** The banks a form stands up beside the water below the lip, so the river runs in a cut. */
function raisedBanks(state: GenerationState, place: PoiPlace) {
  const { banks } = fallShapes[formIn(state, place)],
    reach = reachBelow(state, place, banks.length),
    map = fieldOf(state),
    lip = map.Elevation.get(place.anchor),
    drop = toNative(Math.max(dropOf(state, place), waterfallLeastDrop(map)));
  return reach.flatMap((cell, k): PoiFieldChange[] =>
    banksOf(state, cell, reach).map((near) => ({
      change: "atLeast",
      band: "Elevation",
      cell: near,
      value: lip - drop + banks[k] * drop,
    }))
  );
}
/** A broad ledge: the ground beside the lip comes down level with it. */
function broadLip(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  if (!fallShapes[formIn(state, place)].broadLip) return [];
  const lip = fieldOf(state).Elevation.get(place.anchor);
  return banksOf(state, place.anchor, [place.anchor]).map((cell) => ({
    change: "atMost",
    band: "Elevation",
    cell,
    value: lip,
  }));
}
/** What the water does to the bed below the lip: keeps it clean, or heaps fallen rock on it. */
function bed(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const { banks, debris, scoured } = fallShapes[formIn(state, place)],
    below = reachBelow(state, place, banks.length).slice(1),
    fallen = toNative(debris * Math.max(dropOf(state, place), waterfallLeastDrop(fieldOf(state))));
  return below.flatMap((cell): PoiFieldChange[] => [
    ...(scoured ? [{ change: "atMost", band: "SedimentThickness", cell, value: 0 } as const] : []),
    ...(debris
      ? [{ change: "add", band: "SedimentThickness", cell, amount: fallen } as const]
      : []),
  ]);
}
/** A fall in the ground: its step, the banks of its cut, its lip and its bed. */
export const shapedFall = (state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] => [
  ...step(state, place),
  ...raisedBanks(state, place),
  ...broadLip(state, place),
  ...bed(state, place),
];
/** Nothing grows on the wet rock beside the lip. */
export function wetRock(state: GenerationState, place: PoiPlace) {
  const walls = banksOf(state, place.anchor, [place.anchor]);
  return [...bareOf(walls), ...thinSoilOf(state, walls)];
}
