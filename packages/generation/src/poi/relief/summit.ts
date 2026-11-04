import { prominence } from "../../canonry/landforms";
import type { GenerationState } from "../../process";
import { mapScale, worldPeakIsolation } from "../../worldSignificance";
import { carryWhereItLands, counterpartOf, movesTo } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiPlace } from "../poiContract";
import { cellPlaces, namingCultureNear, within } from "../poiPlaces";
import {
  cellSpan,
  fieldOf,
  gap,
  heightAt,
  heldFor,
  isLand,
  metres,
  nearestWhere,
} from "../poiReads";
import { attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";

/** A summit rules over this many times its prominence around it; seen against this many times its height. */
const dominance = 20;
/** Prominence at which a summit is half as great as summits get. */
const typicalProminence = 1000;

const rise = (state: GenerationState) =>
  heldFor(state, "prominence", () => prominence(fieldOf(state)));
const riseOf = (state: GenerationState, place: PoiPlace) => metres(rise(state).get(place.anchor));
const isA = (state: GenerationState, cell: number) =>
  isLand(state, cell) && rise(state).get(cell) > 0;
const places = cellPlaces("summit", isA);
const foot = (state: GenerationState, place: PoiPlace) =>
  Math.max(2 * cellSpan(state), riseOf(state, place) * dominance);
const counterpart = counterpartOf(isA, 1);

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

export const summit: PoiEntry = {
  id: "summit",
  group: "relief",
  name: "Summit",
  recognition: {
    distinct:
      "A land cell with positive topographic prominence: higher than all ground around it up to its key col. It is a maximum of elevation; a pass is the saddle between two of them, a ridge the crest line joining them.",
    isA,
  },
  existence: {
    statement:
      "Emerges wherever uplift, volcanism and erosion leave a top, at every size the field resolves; a knoll and a great peak are the same kind.",
    way: "emerges",
    requires: notApplicable("A summit is read from the terrain; nothing has to be there first."),
    suitability: notApplicable("Nothing chooses where a summit stands."),
    places,
  },
  fields: {
    statement:
      "A summit changes no field by being one; the terrain makes the summit, and its rain shadow comes from the climate process reading that terrain.",
    terrain: notApplicable("It is a reading of the terrain."),
    water: notApplicable("Its slopes shed water through the ordinary drainage."),
    climate: notApplicable("Orographic effects come from the climate process reading elevation."),
    cover: notApplicable("Cover follows temperature and moisture at its height."),
    magic: notApplicable("A summit is not itself a magic source or carrier."),
  },
  acrossMaps: {
    statement:
      "A captured summit stays a divide of the refined network, and its name moves to the developed top nearest where it stood.",
    carry: carryWhereItLands,
    realize: notApplicable(
      "The drainage cost below makes the divide; relief then develops the top."
    ),
    counterpart,
    unrealized: movesTo(counterpart),
    settle: notApplicable("A summit does not change with a round's water."),
  },
  movement: {
    statement:
      "Roads already pay for its grade through the ruling-grade cost; the drainage network runs around its massif.",
    roads: notApplicable("The ruling-grade cost already reads its slopes."),
    boats: notApplicable("No boat reaches a summit."),
    drainage(state, place, cell) {
      const reach = Math.min(1, Math.max(0.25, riseOf(state, place) / 1000)) * foot(state, place),
        d = gap(state, place.anchor, cell);
      return d < reach ? 1 + (1 - d / reach) : 1;
    },
    magic: notApplicable("A summit neither carries nor blocks magic."),
    crosses: notApplicable("A summit lets no route across anything."),
  },
  others: {
    statement:
      "A summit is never a pass; a pass lies on its shoulder. A settlement within what it rules over may take its name.",
    needs: notApplicable("A summit needs nothing else to stand."),
    excludes: [{ kind: "pass", holds: (_state, a, b) => a.anchor === b.anchor }],
    contains: notApplicable("A summit is one point."),
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
      "A summit lasts as long as the ground stands above its col; erosion lowers it, and a lowered top is simply a lesser summit.",
    fate: () => ({ fate: "persists" }),
  },
  visibility: {
    statement:
      "A summit shows by how far it rises above its own country, how large it is and how alone it stands; a capital at its foot or a town named after it carries it regardless. A 1500 m top over plains outranks the same top among higher peaks, and a 1000 m top with a capital named after it shows when both are passed over by height alone.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.35, localConditions: 0.45, isolation: 0.2 }),
  },
  naming: {
    statement: "Named by the people nearest it; a settlement at its foot may take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("Summits give names; they do not take them."),
    lendsNameTo: [{ kind: "settlement", holds: within((state) => 6 * cellSpan(state)) }],
  },
};
