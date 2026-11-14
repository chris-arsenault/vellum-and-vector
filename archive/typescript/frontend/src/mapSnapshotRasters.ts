import {
  fieldChannelName,
  ownsMapGeography,
  compactGeometryBounds,
  spatial,
  type DomainSnapshot,
  type FieldRef,
  type FieldChannelName,
} from "@atlas/domain";
import type { LoadedRaster } from "./types";
import type { MapFeature } from "@atlas/map";
import { mapRasterFields } from "./workspaceRasters";

/** The same channel precedence as current map viewing, resolved once from completed inputs. */
export function mapSnapshotChannels(snapshot: DomainSnapshot, areaId: string) {
  const selected = new Map<FieldChannelName, FieldRef>();
  for (const field of mapRasterFields(snapshot.world, areaId))
    for (const name of field.channels ?? []) selected.set(fieldChannelName(name), field);
  return selected;
}

/** A publishing host reads generation fields; the resulting reader sees only GIS assets. */
export function* mapSnapshotRasters(
  snapshot: DomainSnapshot,
  areaId: string,
  features: () => Iterable<MapFeature>
): Generator<LoadedRaster> {
  const world = snapshot.world;
  const selected = mapSnapshotChannels(snapshot, areaId);
  const fields = mapRasterFields(world, areaId).reverse();
  const domain = spatial.bounds(world.reference.domain);
  for (const [channel, field] of selected) {
    const grid = snapshot.numerical[field.id];
    if (!grid?.channels[channel])
      throw new Error(`Load ${field.id}:${channel} before map publication.`);
    if (channel.startsWith("magicApplied:") || grid.units[channel] === "cell-index") continue;
    const footprint = mapFootprint(snapshot, areaId, grid.scope.footprint);
    if (!footprint) continue;
    const raster: LoadedRaster = {
      id: field.id,
      areaId,
      channel,
      field: grid,
      footprint,
      bounds: compactGeometryBounds(world.reference, footprint),
      wrap: world.reference.boundaryMode === "cylinder" ? [domain[0], domain[2]] : undefined,
    };
    if (channel === "Elevation") {
      const companion = (name: string) => {
        const source = fields.find(
          (candidate) =>
            candidate.areaId === field.areaId &&
            candidate.input === field.input &&
            candidate.channels?.includes(name)
        );
        return source ? snapshot.numerical[source.id] : undefined;
      };
      raster.water = companion("WaterKindCodes");
      raster.ice = companion("IceThickness");
      raster.surface = companion("finalSurface");
      raster.lakes = publishedLakes(grid.lakes ?? [], features());
    }
    yield raster;
  }
}
function mapFootprint(
  snapshot: DomainSnapshot,
  areaId: string,
  footprint: LoadedRaster["footprint"]
) {
  return ownsMapGeography(snapshot.world, areaId)
    ? footprint
    : spatial.intersection(footprint, snapshot.world.areas[areaId].footprint);
}
function publishedLakes(
  physical: NonNullable<LoadedRaster["field"]["lakes"]>,
  features: Iterable<MapFeature>
) {
  const lakes = new Map<string, NonNullable<LoadedRaster["lakes"]>[number]>();
  for (const feature of features) {
    if (feature.kind !== "lake" || typeof feature.attributes.waterLevel !== "number") continue;
    lakes.set(feature.id, { geometry: feature.geometry, level: feature.attributes.waterLevel });
  }
  for (const lake of physical) {
    const previous = lakes.get(lake.id);
    lakes.set(lake.id, {
      level: lake.level,
      geometry: previous ? spatial.union(previous.geometry, lake.geometry) : lake.geometry,
    });
  }
  return [...lakes.values()];
}
