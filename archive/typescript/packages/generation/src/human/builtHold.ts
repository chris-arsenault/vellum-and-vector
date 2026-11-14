import { humanLayers } from "@atlas/domain";
import { respond } from "../coupling/answers";
import { fullStandingPerBuiltKm2 } from "./layerCatalogue";

/**
 * Built ground holds against what would move it, as roots do: walls, terraces, paving and
 * drains keep soil and rubble where they are. A place of full standing holds twice what bare
 * buildings do. Physical processes meet this through the question they already ask about
 * what binds the ground; none of them knows a town is there.
 */
respond({
  key: "rootHold",
  by: "built places",
  reads: [humanLayers.builtUp, humanLayers.standing],
  add(map, i) {
    const built = map[humanLayers.builtUp].get(i);
    if (!(built > 0)) return 0;
    const standing = Math.min(
      1,
      map[humanLayers.standing].get(i) / (built * fullStandingPerBuiltKm2)
    );
    return built * (1 + standing);
  },
});
