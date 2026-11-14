import { spatial } from "@atlas/domain";
import { realizeFaults } from "../../world/fractureRealization";
import { courseLines } from "../courses";
import { registerCause } from "./registry";

registerCause({
  kind: "fault",
  read(state) {
    const map = state.physical.map,
      [ox, oy] = map.mesh.origin,
      faults = [] as typeof map.faults;
    for (const feature of state.sourceFeatures?.values({ areaId: state.regional.input.areaId }) ??
      []) {
      if (feature.kind !== "fault") continue;
      const local = {
          type: "MultiLineString" as const,
          coordinates: courseLines(feature.geometry).map((line) =>
            line.map(([x, y]) => [x - ox, y - oy])
          ),
        },
        clipped = spatial.clipByRect(local, map.mesh.bounds);
      if (!clipped) continue;
      const width = Number(feature.attributes.width);
      if (!(width > 0)) continue;
      for (const line of courseLines(clipped))
        faults.push({ id: feature.id, width, coordinates: line.map(([x, y]) => [x, y]) });
    }
    realizeFaults(map, faults, state.physical.profile.FractureWidth);
  },
});
