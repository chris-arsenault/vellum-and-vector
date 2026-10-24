import { useQuery } from "@tanstack/react-query";
import { readScene, readRaster } from "./atlasReads";
import { bounds } from "./presentation";
import { areaSpace, spatial } from "@atlas/domain";
import { profiles, type Area, type AtlasFeature, type World } from "./types";

export function useMapData(world: World, areaId: string, extent: number[] | null = null) {
  const scene = useScene(world, areaId, extent);
  const raster = useQuery({
    queryKey: ["fields", world.id, areaId, world.version],
    queryFn: () =>
      world.fields
        .filter((field) => areaSpace(world, field.areaId) === areaSpace(world, areaId))
        .sort(
          (a, b) =>
            profiles.indexOf(world.areas[a.areaId].profile) -
            profiles.indexOf(world.areas[b.areaId].profile)
        )
        .flatMap((field) =>
          (field.channels ?? [])
            .filter((channel) => channel !== "elevation" && !channel.startsWith("magicApplied:"))
            .map((channel) => readRaster(world.id, field.id, channel))
        )
        .filter((raster) => raster.field.units[raster.channel] !== "cell-index"),
  });
  const baseRaster = useRasters(world, areaId, "elevation", extent);
  return { scene, raster, baseRaster };
}

export function editArea(world: World, areaId: string, feature: AtlasFeature) {
  for (let current: string | null = areaId; current; current = world.areas[current].parentId)
    if (current === feature.areaId) return areaId;
  return feature.areaId;
}
export function scopedFootprint(world: World, areaId: string, feature: AtlasFeature) {
  if (!feature.footprint || feature.areaId === areaId) return feature;
  const footprint = spatial.intersection(feature.footprint, world.areas[areaId].footprint);
  const local = { ...feature };
  delete local.footprint;
  if (footprint) local.footprint = footprint;
  return local;
}

export function useScene(
  world: World,
  areaId: string,
  extent: number[] | null | undefined = undefined
) {
  return useQuery({
    queryKey: ["scene", world.id, areaId, world.version],
    enabled: extent !== null,
    placeholderData: (previous, query) => (query?.queryKey[2] === areaId ? previous : undefined),
    queryFn: () => readScene(world.id, areaId),
  });
}

function space(world: World, area: Area): string | null {
  if (area.profile === "interior" || area.context === "cave" || area.frame.floor !== null)
    return area.id;
  return area.parentId ? space(world, world.areas[area.parentId]) : null;
}

export function useRasters(
  world: World,
  areaId: string,
  channel: string,
  viewport: number[] | null | undefined = undefined
) {
  const area = world.areas[areaId];
  const extent =
    viewport && world.reference.boundaryMode === "cylinder"
      ? [
          bounds(world.reference.domain)[0],
          viewport[1],
          bounds(world.reference.domain)[2],
          viewport[3],
        ]
      : (viewport ?? bounds(area.footprint));
  const fields = world.fields
    .filter((f) => {
      if (f.channels && !f.channels.includes(channel)) return false;
      if (!f.channels && f.layerId !== channel && f.layerId !== "elevation") return false;
      const owner = world.areas[f.areaId];
      const box = bounds(owner.footprint);
      return (
        space(world, owner) === space(world, area) &&
        box[0] <= extent[2] &&
        box[2] >= extent[0] &&
        box[1] <= extent[3] &&
        box[3] >= extent[1]
      );
    })
    .sort(
      (a, b) =>
        profiles.indexOf(world.areas[a.areaId].profile) -
        profiles.indexOf(world.areas[b.areaId].profile)
    );
  return useQuery({
    queryKey: [
      "rasters",
      world.id,
      world.version,
      areaId,
      fields.map((f) => f.id).join(","),
      channel,
    ],
    enabled: viewport !== null,
    queryFn: () => fields.map((f) => readRaster(world.id, f.id, channel)),
  });
}
