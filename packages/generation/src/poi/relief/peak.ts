// @needsResolution carry: a carried place may not resolve on a finer map (ADR 0009).
import { Landform } from "../../canonry/codes";
import { hashUnit } from "../../canonry/noise";
import { prominence } from "../../canonry/landforms";
import { meshDeltaX } from "../../canonry/mesh";
import type { GenerationState } from "../../process";
import { repulsion } from "../../regional/network";
import type { RegionalState } from "../../regional/state";
import { mapScale, worldPeakIsolation } from "../../worldSignificance";
import { carryWhereItLands, movesTo } from "../poiCarry";
import {
  notApplicable,
  type PoiCarried,
  type PoiEntry,
  type PoiFieldChange,
  type PoiNameTerm,
  type PoiPlace,
  type PoiVariety,
} from "../poiContract";
import { claimsOf, placesFromOrigins } from "../poiOrigins";
import { namingCultureNear, within } from "../poiPlaces";
import { siteRecord } from "../poiRecords";
import {
  celsiusAt,
  cellSpan,
  cellsWithin,
  fieldOf,
  gap,
  hardnessAt,
  heightAt,
  heldFor,
  iceAt,
  isLand,
  hasChannel,
  jointedAt,
  metres,
  moistureAt,
  nearestWhere,
  rockKindAt,
  slopeAt,
  toNative,
} from "../poiReads";
import { varietyOf } from "../poiVariety";
import { attachment, sized, standsOut, weighed } from "../poiVisibilityRules";
import { peakForm, peakShape, type PeakForm } from "./peakForms";
import { peakOrigins } from "./peakOrigins";
import { bareOf, ringHeights, sectionRadius, thinSoilOf } from "./reliefShape";

/** A peak rules over this many times its prominence around it; seen against this many times its height. */
const dominance = 20;
/** Prominence at which a peak is half as great as peaks get. */
const typicalProminence = 1000;
/** What some peaks weigh for the reason they are peaks, whatever their size. */
const originWeight: Readonly<Record<string, number>> = { crown: 0.85, carried: 0.7 };
/** The word people use for a peak of each form. */
const formTerms: Readonly<Record<PeakForm, string>> = {
  horn: "Horn",
  crag: "Crag",
  scarred: "Scar",
  dome: "Dome",
  shattered: "Scree",
  table: "Table",
};
/** The size a form works at: a share of the rise, and a floor at the World's scale, in metres. */
const formShare = 0.25,
  formFloor = 80,
  largestForm = 1500;
/** A form reaches at least this many cells, so a coarse map can show it at all. */
const formSpans = 2.2;
/** Ice that loads a top fully, and the readings of cold and steepness that do. */
const fullIce = 100,
  fullCold = 15,
  fullSteep = 0.3;
const salts = { form: 0x7021, face: 0x7022 };

const unit = (value: number) => Math.max(0, Math.min(1, value));
const rise = (state: GenerationState) =>
  heldFor(state, "prominence", () => prominence(fieldOf(state)));
const riseOf = (state: GenerationState, place: PoiPlace) => metres(rise(state).get(place.anchor));
const claims = (state: GenerationState) => claimsOf(state, "peak", peakOrigins);
const isA = (state: GenerationState, cell: number) => claims(state).has(cell);
const originOf = (state: GenerationState, place: PoiPlace) =>
  claims(state).get(place.anchor)?.origin ?? "high";
const places = (state: GenerationState) => placesFromOrigins("peak", peakOrigins)(state);
const foot = (state: GenerationState, place: PoiPlace) =>
  Math.max(2 * cellSpan(state), riseOf(state, place) * dominance);
/** The greatest peak within the parent's cell of where a captured peak stood, or -1. */
function counterpart(state: RegionalState, carried: PoiCarried) {
  let best = -1;
  for (const cell of cellsWithin(state, carried.cell, state.regional.parentSpan))
    if (isA(state, cell) && (best < 0 || rise(state).get(cell) > rise(state).get(best)))
      best = cell;
  return best;
}
/** How far a captured peak reads as rising: the parent's own record, as it published it. */
const capturedRise = (place: PoiPlace) => Number(place.feature?.attributes.prominence ?? 300);

/** What the ground under a peak gives its form: rock, ice and weather. */
function formOf(state: GenerationState, cell: number): PeakForm {
  return peakForm(
    {
      hardness: hardnessAt(state, cell),
      fracture: jointedAt(state, cell),
      ice: unit(iceAt(state, cell) / fullIce),
      cold: unit(-celsiusAt(state, cell) / fullCold),
      wet: unit(moistureAt(state, cell)),
      steep: unit(slopeAt(state, cell) / fullSteep),
      bedded: rockKindAt(state, cell).bedding,
    },
    hashUnit(salts.form, cell, 0)
  );
}
const variety: PoiVariety = {
  statement:
    "Rock, ice and weather weigh each form and chance picks among them, so hard rock usually stands as a crag and sometimes does not.",
  of: (state, place) => formOf(state, place.anchor),
};
const formIn = (state: GenerationState, place: PoiPlace) =>
  varietyOf(state, variety, place) as PeakForm;
const nameTerm = (state: GenerationState, place: PoiPlace): PoiNameTerm => ({
  kind: "landform",
  subkind: "peak",
  term: formTerms[formIn(state, place)],
});
/** The way a peak's chosen face looks: down its steepest side, give or take a quarter turn. */
function faceOf(state: GenerationState, cell: number) {
  const ring = ringHeights(state, cell, sectionRadius(state));
  let low = 0;
  ring.forEach((height, at) => {
    if (Number.isFinite(height) && height < ring[low]) low = at;
  });
  return (low * Math.PI) / 8 + (hashUnit(salts.face, cell, 0) - 0.5) * (Math.PI / 2);
}
const formSize = (state: GenerationState, place: PoiPlace) =>
  Math.min(largestForm, formShare * riseOf(state, place) + formFloor * mapScale(state).height);
const formReach = (state: GenerationState, place: PoiPlace) =>
  Math.max(formSpans * cellSpan(state), 0.8 * foot(state, place));
/** The ground a peak's form works on, with what it does at each cell. */
const formed = (state: GenerationState, place: PoiPlace) =>
  heldFor(state, `peak:form:${place.anchor}`, () => {
    const mesh = fieldOf(state).mesh,
      form = formIn(state, place),
      face = faceOf(state, place.anchor),
      reach = formReach(state, place);
    return cellsWithin(state, place.anchor, reach)
      .filter((cell) => isLand(state, cell) && !hasChannel(state, cell))
      .map((cell) => {
        const dx = meshDeltaX(mesh, mesh.x(cell) - mesh.x(place.anchor)),
          dy = mesh.y(cell) - mesh.y(place.anchor);
        return {
          cell,
          shape: peakShape(form, {
            reach: Math.hypot(dx, dy) / reach,
            bearing: Math.atan2(dy, dx),
            face,
          }),
        };
      });
  });
/** A peak's form in the ground: the rock raised or cut away, and what fell from it. */
function shapedGround(state: GenerationState, place: PoiPlace): readonly PoiFieldChange[] {
  const size = formSize(state, place);
  return formed(state, place).flatMap(({ cell, shape }): PoiFieldChange[] => [
    ...(shape.ground
      ? [{ change: "add", band: "Elevation", cell, amount: toNative(shape.ground * size) } as const]
      : []),
    ...(shape.debris
      ? [
          {
            change: "add",
            band: "SedimentThickness",
            cell,
            amount: toNative(shape.debris * size),
          } as const,
        ]
      : []),
  ]);
}
/** What grows nowhere on a peak's raw rock. */
function rawRock(state: GenerationState, place: PoiPlace) {
  const bare = formed(state, place)
    .filter(({ shape }) => shape.bare)
    .map(({ cell }) => cell);
  return [...bareOf(bare), ...thinSoilOf(bare)];
}

const factors = {
  magnitude: sized(riseOf, typicalProminence),
  localConditions: standsOut(heightAt, (state, place) =>
    Math.max(2 * cellSpan(state), heightAt(state, place.anchor) * dominance)
  ),
  /** Half when the nearest higher ground lies at the edge of what it rules over. */
  isolation(state: GenerationState, place: PoiPlace) {
    const top = fieldOf(state).Elevation.get(place.anchor),
      reach = worldPeakIsolation * mapScale(state).length,
      higher = nearestWhere(
        state,
        place.anchor,
        reach,
        (c) => fieldOf(state).Elevation.get(c) > top
      ),
      d = higher < 0 ? reach : gap(state, place.anchor, higher),
      ruled = foot(state, place);
    return d / (d + ruled);
  },
  cultural: attachment(foot),
};
const weight = weighed(factors, { magnitude: 0.35, localConditions: 0.45, isolation: 0.2 });

export const peak: PoiEntry = {
  id: "peak",
  group: "relief",
  name: "Peak",
  recognition: {
    distinct:
      "A top that is known as one: the tallest point of its range, a top ruling its part of a range, a top standing well clear of its country, a mark sailors steer by, the horn above a great crossing, or the mountain a town lives under. Most tops are none of these and stay latent. A pass is the saddle between tops, a ridge the crest line joining them.",
    isA,
    landform: { code: Landform.Peak, yieldsTo: [Landform.Waterfall] },
  },
  existence: {
    origins: peakOrigins,
    statement:
      "Emerges from uplift, volcanism and erosion, and is made a peak by standing as something: a range always has its crown, its other tops need to rule their part of it, and out of a range a top must stand well clear. People and movement make others: mountain towns sometimes name the top above them, passes the horn above them, and sailors the top they see from the sea. A peak the coarser map named stays one.",
    way: "emerges",
    requires: notApplicable("A peak is read from the terrain; nothing has to be there first."),
    suitability: notApplicable("Nothing chooses where a top stands; only which tops are known."),
    places,
  },
  publication: {
    statement:
      "Each peak publishes with what it rises above its key col, why it is one and its form. A peak a town makes on the World comes later than the rest, once there are towns; the World's ground is settled by then, so it is a named top without a form in the ground.",
    moment: "geography",
    record: siteRecord({
      kind: "peak",
      layer: "geology",
      name: "Peak",
      attributes: (state, place) => ({
        prominence: riseOf(state, place),
      }),
    }),
  },
  fields: {
    statement:
      "A peak works the ground around it by its rock, its ice and chance: ice cuts hard rock into a horn, weather leaves a hard core standing as a crag, avalanches cut one side of a steep snowy top and heap the debris below, massive rock swells into a dome, weak rock falls into its own debris, and flat beds leave a table. Bare rock grows nothing and holds little soil.",
    terrain: shapedGround,
    water: notApplicable("Its slopes shed water through the ordinary drainage."),
    climate: notApplicable("Orographic effects come from the climate process reading elevation."),
    cover: rawRock,
    magic: notApplicable("A peak is not itself a magic source or carrier."),
  },
  acrossMaps: {
    statement:
      "A captured peak stays a divide of the refined network, and its name moves to the greatest top within its parent's cell, which is a peak for that reason. Its form is the finer map's own: finer ground shows what the coarser map could not.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The drainage cost below makes the divide; relief then develops the top, and the top's own form follows."
    ),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("A peak does not change with a round's water."),
    schedule: notApplicable("Its drainage cost is all a peak does at refinement's other points."),
  },
  movement: {
    statement:
      "Roads already pay for its grade through the ruling-grade cost; on a refined map the drainage network runs around a captured peak's massif, as wide as its prominence suggests.",
    roads: notApplicable("The ruling-grade cost already reads its slopes."),
    boats: notApplicable("No boat reaches a peak."),
    drainage: (state, place) =>
      repulsion(
        state as RegionalState,
        place.anchor,
        Math.min(1, Math.max(0.25, capturedRise(place) / typicalProminence)) *
          (state as RegionalState).regional.parentSpan
      ),
    magic: notApplicable("A peak neither carries nor blocks magic."),
    links: notApplicable("A peak joins nothing."),
    crosses: notApplicable("A peak lets no route across anything."),
  },
  others: {
    statement:
      "A peak is never a pass; a pass lies on its shoulder. A mountain town may make its nearest top a peak (see its origins), and a town near a peak may take its name.",
    needs: notApplicable("A peak needs nothing else to stand."),
    excludes: [{ kind: "pass", holds: (_state, a, b) => a.anchor === b.anchor }],
    contains: notApplicable("A peak is one point."),
    pairsWith: [{ kind: "pass", holds: within((state) => 4 * cellSpan(state)) }],
  },
  people: {
    statement:
      "A high point is a landmark and a holy height to those beneath it; iced steep ground above people sheds avalanches.",
    offers: (state, place) => ({ sanctity: factors.magnitude(state, place) }),
    threatens(state, place) {
      const map = fieldOf(state);
      return map.Slope.get(place.anchor) > 0.15 && map.IceThickness.get(place.anchor) > 1
        ? [{ hazard: "avalanche", reach: foot(state, place) / 2, severity: 0.5 }]
        : [];
    },
  },
  time: {
    statement:
      "A peak lasts as long as the ground stands above its col; erosion lowers it, and a lowered top is simply a lesser one, or no longer known as a peak.",
    fate: () => ({ fate: "persists" }),
  },
  visibility: {
    statement:
      "A peak shows by how far it rises above its own country, how large it is and how alone it stands; a range's crown and a peak the coarser map named show for being those; a capital at its foot or a town named after it carries it regardless.",
    ...factors,
    importance: (state, place) =>
      Math.max(weight(state, place), originWeight[originOf(state, place)] ?? 0),
  },
  naming: {
    statement:
      "Named by the people nearest it, in words for its form; a settlement at its foot may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Peaks give names; they do not take them."),
    lendsNameTo: [{ kind: "settlement", holds: within((state) => 6 * cellSpan(state)) }],
    term: nameTerm,
  },
  variety,
};
