import { areaSpace, landmarkFootprint, spatial, type DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";

/** Authored landmarks whose footprint reaches this extent and whose epoch is in this history. */
export function landmarksInExtent(
  source: DomainSnapshot,
  input: Pick<AtlasGenerationInput, "areaId" | "settings">
) {
  const area = source.world.areas[input.areaId],
    spaceId = areaSpace(source.world, area.id),
    epochs = input.settings?.epochs.length ?? source.world.epochs.length;
  return (source.world.landmarks ?? []).filter(
    (landmark) =>
      (!landmark.spaceId || landmark.spaceId === spaceId) &&
      landmark.emplacedAtEpoch < epochs &&
      spatial.intersects(landmarkFootprint(landmark), area.footprint)
  );
}
