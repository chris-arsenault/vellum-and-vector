import { spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { poiCatalogue } from "../poi/catalogue";
import { placesOf } from "../poi/poiPublish";
import { releaseHeld } from "../poi/poiReads";
import { components, publishPlace } from "./geographicRegions";
import { isRange, mountainTest } from "./rangeGroups";

/** Mountain ranges as connected mountain land, read from the generated surface. */
export function extractRanges(state: GenerationState) {
  releaseHeld(state);
  const dry = state.surface.ocean
      ? spatial.differenceFrom(state.surface.ocean)
      : (shape: Geometry): Geometry | null => shape,
    tops = new Set(placesOf(state, poiCatalogue.peak).map((place) => place.anchor));
  components(
    state,
    mountainTest(state),
    (members, extent) => {
      const surface = extent && dry(extent);
      if (!surface || !isRange(state, members)) return;
      publishPlace(
        state,
        "range",
        "Range",
        members,
        "geology",
        { peaks: members.filter((i) => tops.has(i)).length, area: spatial.area(surface) },
        surface
      );
    },
    true,
    true
  );
}
