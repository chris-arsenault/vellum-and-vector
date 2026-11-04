import { Feature } from "../../canonry/codes";
import type { GenerationState } from "../../process";
import { carryWhereItLands, costNear, stays } from "../poiCarry";
import { notApplicable, type PoiEntry, type PoiFate, type PoiPlace } from "../poiContract";
import { holds, namingCultureNear, regionPlaces, within } from "../poiPlaces";
import { fieldOf, heightAt } from "../poiReads";
import { aloneAmong, attachment, drawnWhen, sized, standsOut } from "../poiVisibilityRules";
import {
  holdAt,
  nearestOrTop,
  raisedAsCaptured,
  reliefOf,
  sameSpot,
  sectionAt,
  sitingAdmits,
  sitingSuits,
  spans,
} from "./reliefShape";

/** Surviving relief at which a volcano is half as great as volcanoes get: a world mountain's. */
const typicalRelief = 1000;

const flags = (state: GenerationState, cell: number) => fieldOf(state).FeatureFlags.get(cell);
const isA = (state: GenerationState, cell: number) =>
  (flags(state, cell) & Feature.VolcanicCone) !== 0;
const places = regionPlaces("volcano", isA, heightAt);
/** How active the plume or arc under it is now, in [0, 1]. */
const activity = (state: GenerationState, place: PoiPlace) =>
  fieldOf(state).VolcanicActivity.get(place.anchor) / 1000;
const counterpart = nearestOrTop(isA);
const standing = (state: GenerationState, place: PoiPlace) =>
  sectionAt(state, place.anchor).crest > 0;
const factors = {
  magnitude: sized(reliefOf, typicalRelief),
  localConditions: standsOut(heightAt, spans(8)),
  isolation: aloneAmong(places, spans(10)),
  /** A live mountain is known and feared whoever lives at its foot. */
  cultural: (state: GenerationState, place: PoiPlace) =>
    Math.max(attachment(spans(10))(state, place), activity(state, place) / 2),
};

export const volcano: PoiEntry = {
  id: "volcano",
  group: "relief",
  name: "Volcano",
  recognition: {
    distinct:
      "A cell the generator flagged Feature.VolcanicCone: inside the cone that a plume, an arc or a volcanic-mountain record built. It is decided by that construction, not by shape: a dome rises without lava, a summit needs no flag, and the broad apron round a cone is flagged LavaPlain and belongs to a basalt flat. Whether it is live (VolcanicActivity) or long dead is a property, and a drowned cone is the same kind.",
    isA,
  },
  existence: {
    statement:
      "Both: emerging where a plume head sits this epoch, leaving a chain of older cones as the crust moves, or along a subduction arc; and sited as a great mountain on quiet plains by a landmark record.",
    way: "both",
    requires: sitingAdmits("volcanic-mountain"),
    suitability: sitingSuits("volcanic-mountain"),
    places,
  },
  fields: {
    statement:
      "A live volcano builds its own mountain and opens the rock under it to heat and fracture; its fresh flows strip soil. A dead one keeps the rock it made and sheds water radially.",
    terrain: (state, place) => holdAt(state, "atLeast", "Elevation", place.cells),
    water: notApplicable(
      "Its radial streams are ordinary drainage off a high point; its heat reaches water through the springs and vents that are their own entries."
    ),
    climate: notApplicable(
      "Eruptive ash has no band; the climate sees only the height it reads like any mountain's."
    ),
    cover: (state, place) =>
      place.cells
        .filter((cell) => fieldOf(state).VolcanicActivity.get(cell) > 0)
        .map((cell) => ({ change: "atMost" as const, band: "SoilDepth" as const, cell, value: 0 })),
    magic: (state, place) => [
      ...holdAt(state, "atLeast", "FractureConductance", place.cells),
      ...holdAt(state, "atLeast", "Geothermal", place.cells),
    ],
  },
  acrossMaps: {
    statement:
      "A captured volcano is a massif the refined network runs around, its top standing as high as the parent's. Maps below the world do not carry the cone flag, so the counterpart is the developed top near the record when no flagged cell reads; the record stays regardless.",
    carry: carryWhereItLands,
    realize: (state, carried) => raisedAsCaptured(state, carried, counterpart(state, carried)),
    counterpart,
    unrealized: stays,
    settle: notApplicable("Its height is built over epochs; a round's water does not move it."),
  },
  movement: {
    statement:
      "Roads avoid a cone's loose steep flanks and the network runs around its massif; the open fractures beneath it conduct whatever the crust carries, Fire above all.",
    roads: costNear(1.5),
    boats: notApplicable("A cone offers boats nothing; a drowned one is seabed to them."),
    drainage: costNear(3),
    magic: costNear(0.6),
    crosses: notApplicable("A volcano bars routes; it carries none across a barrier."),
  },
  others: {
    statement:
      "A volcano contains its caldera, stands on its own lava apron, and heats veins, springs and vents around it; a dome or crater cannot share its centre.",
    needs: notApplicable("A plume, arc or record builds it; none is a catalogue place."),
    excludes: [
      { kind: "dome", holds: sameSpot },
      { kind: "crater", holds: sameSpot },
    ],
    contains: [{ kind: "caldera", holds }],
    pairsWith: [
      { kind: "basaltFlat", holds: within(spans(8)) },
      { kind: "thermalVein", holds: within(spans(8)) },
      { kind: "spring", holds: within(spans(6)) },
      { kind: "vent", holds: within(spans(6)) },
    ],
  },
  people: {
    statement:
      "A volcano gives fertile ash, stone and a god to fear. While it lives it threatens everything on its apron, in proportion to its activity; a dead one threatens nothing.",
    offers(state, place) {
      const great = factors.magnitude(state, place);
      return {
        food: great / 2,
        materials: great / 2,
        sanctity: Math.max(great, activity(state, place)),
      };
    },
    threatens(state, place) {
      const live = activity(state, place);
      return live > 0
        ? [
            {
              hazard: "eruption",
              reach: state.physical!.profile.MantlePlumeRadius,
              severity: live,
            },
          ]
        : [];
    },
  },
  time: {
    statement:
      "A cone grows while its plume or arc is under it; the crust then carries it off and it goes dead. Erosion takes it down to a neck and a lava field, and when it no longer stands above the ground around it, only the basalt is left.",
    fate(state, place): PoiFate {
      return activity(state, place) > 0 || standing(state, place)
        ? { fate: "persists" }
        : { fate: "ends", leaves: "basaltFlat" };
    },
  },
  visibility: {
    statement:
      "A volcano shows by the relief that survives, and stands out sooner alone on plains than in a chain; a live one carries weight beyond its size, because people know it.",
    ...factors,
    visibleAt: drawnWhen(factors, { magnitude: 0.5, localConditions: 0.35, isolation: 0.15 }),
  },
  naming: {
    statement:
      "Named by those in its shadow, often for what they fear in it; a generator-sited one is named once. Its caldera and the town at its foot take its name.",
    namedBy: namingCultureNear,
    takesNameFrom: notApplicable("A volcano is named for itself; lesser places take from it."),
    lendsNameTo: [
      { kind: "caldera", holds },
      { kind: "settlement", holds: within(spans(8)) },
    ],
  },
};
