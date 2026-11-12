import { rememberCourse } from "../../water/rivers";
import { courseCells, courseLines } from "../courses";
import { registerCause } from "./registry";

/**
 * A parent map's old river bed that crosses this frame is still an old bed here: the ground
 * on its line remembers the river it carried. The water owner keeps that memory from then
 * on, by the same rule as its own beds: it lasts where the ground is too dry to heal it, and
 * a river that runs there again takes the bed back.
 */
registerCause({
  kind: "dryBed",
  read(state) {
    const reader = state.sourceFeatures;
    if (!reader) return;
    for (const feature of reader.values({ areaId: state.regional.input.areaId })) {
      if (feature.kind !== "dryBed") continue;
      rememberCourse(
        state.physical.map,
        courseCells(state, courseLines(feature.geometry)),
        Number(feature.attributes.order ?? 1)
      );
    }
  },
});
