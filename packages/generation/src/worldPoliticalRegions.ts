import { spatial, type AtlasFeature } from "@atlas/domain";
import type { GenerationState } from "./process";
import { largeWorldDomain, largeDomainSpan, mapScale } from "./worldSignificance";
import { landArea } from "./world/regionPartition";
import { partitionWorldRegion } from "./world/worldRegionPartition";
import { components, publishPlace } from "./world/geographicRegions";
import { membershipSampler, geographicContour } from "./world/geographicContours";
import { nativePosition } from "./world/atlasWorkspace";
import { workingArray, releaseWorking } from "./world/physicalNumerics";

/** Continental possessions have geographic parts, all belonging to the same polity. */
export function publishPoliticalRegions(state: GenerationState, parent: AtlasFeature) {
  if (!state.physical) return;
  const bounds = spatial.bounds(parent.geometry),
    span = Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  const scale = mapScale(state);
  if (span < largeDomainSpan * scale.length) return;
  const land = landArea(state);
  if (!largeWorldDomain(spatial.area(parent.geometry), span, land, scale)) return;
  const work = state.physical,
    map = work.map,
    covers = spatial.pointCoverage(parent.geometry),
    labels = workingArray(map, "int32", "polity:geographic-parts").fill(-1);
  try {
    components(
      state,
      (i) => covers(nativePosition(work, i)),
      (members) => {
        const pieces = partitionWorldRegion(state, members, land);
        if (pieces.length < 2) return;
        pieces.forEach((piece, n) => piece.forEach((i) => labels.set(i, n)));
        const shares = pieces.map((_, n) =>
          membershipSampler(state, (i) => Number(labels.get(i) === n))
        );
        pieces.forEach((piece, n) => {
          const shape = geographicContour(
              state,
              piece,
              (x, y) =>
                shares[n](x, y) -
                shares.reduce(
                  (other, sample, j) => (j === n ? other : Math.max(other, sample(x, y))),
                  0.1
                ),
              0
            ),
            clipped = shape && spatial.intersection(shape, parent.geometry);
          if (!clipped) return;
          publishPlace(
            state,
            "politicalRegion",
            `${parent.name} region`,
            piece,
            parent.layerId,
            {
              parentTerritory: parent.id,
              polity: parent.relations[0]?.targetId,
              boundaryDerivation: "supported-reach",
              geometryMeaning: "geographic part of a continental territory",
            },
            clipped,
            null,
            [{ targetId: parent.id, kind: "partOf" }, ...parent.relations]
          );
        });
        for (const i of members) labels.set(i, -1);
      }
    );
  } finally {
    releaseWorking(map, labels);
  }
}
