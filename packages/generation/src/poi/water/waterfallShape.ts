import { riverDrop, waterfallLeastDrop } from "../../canonry/landforms";
import { hashUnit } from "../../canonry/noise";
import type { GenerationState } from "../../process";
import { worldFallsDischarge, worldFallsDrop } from "../../worldSignificance";
import type { PoiFieldChange, PoiPlace, PoiVariety } from "../poiContract";
import { adjacent, fieldOf, fractureAt, isLand, isRiver, toNative } from "../poiReads";
import { varietyOf } from "../poiVariety";
import { sized } from "../poiVisibilityRules";
import { bareOf, thinSoilOf } from "../relief/reliefShape";
import { fallForm, fallShapes, type FallForm } from "./waterfallForms";
import { flowTarget } from "./waterReads";

/** Rock resistance of soft rock and hard. */
const softRock = 700,
  hardRock = 1500;
const salt = 0x7042;
const unit = (value: number) => Math.max(0, Math.min(1, value));

export const dropOf = (state: GenerationState, place: PoiPlace) =>
  riverDrop(fieldOf(state), place.anchor);
export const dischargeOf = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).FlowAccumulation.get(place.anchor);

export const fallVariety: PoiVariety = {
  statement:
    "Rock and the river's own size weigh each form and chance picks among them: a great river makes a cataract, broken rock a cascade, a tall thin fall a ribbon, hard rock a plunge or a chute.",
  of(state, place) {
    const cell = place.anchor;
    return fallForm(
      {
        hardness: unit(
          (fieldOf(state).RockResistance.get(cell) - softRock) / (hardRock - softRock)
        ),
        fracture: unit(fractureAt(state, cell)),
        tall: sized(dropOf, worldFallsDrop)(state, place),
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
  const drop = Math.max(dropOf(state, place), waterfallLeastDrop);
  return [
    { change: "atLeast", band: "Elevation", cell: place.anchor, value: lip },
    { change: "atMost", band: "Elevation", cell: target, value: lip - toNative(drop) },
  ];
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
  isLand(state, cell) && !isRiver(state, cell) && !reach.includes(cell);
const banksOf = (state: GenerationState, cell: number, reach: readonly number[]) =>
  [...adjacent(state, cell)].filter((near) => isBank(state, near, reach));

/** The banks a form stands up beside the water below the lip, so the river runs in a cut. */
function raisedBanks(state: GenerationState, place: PoiPlace) {
  const { banks } = fallShapes[formIn(state, place)],
    reach = reachBelow(state, place, banks.length),
    map = fieldOf(state),
    lip = map.Elevation.get(place.anchor),
    drop = toNative(Math.max(dropOf(state, place), waterfallLeastDrop));
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
    fallen = toNative(debris * Math.max(dropOf(state, place), waterfallLeastDrop));
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
  return [...bareOf(walls), ...thinSoilOf(walls)];
}
