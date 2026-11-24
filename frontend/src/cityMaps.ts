import type { MapDescriptor, RegionGeometry, RegionSelection } from "@atlas/map";
import type { CityChoice, RealScaleChoice } from "@atlas/context";
import type { PublishedFeature } from "./publishedAppearance";
import { pointSelection } from "./realScale";

/** A settlement on a regional map opens as a city map over its surroundings. */
export function citySelection(
  map: MapDescriptor,
  settlement: PublishedFeature
): { selection: RegionSelection; city: CityChoice } | null {
  if (map.realScale || settlement.kind !== "settlement") return null;
  const geometry = settlement.geometry;
  const city = { settlement: settlement.id };
  if (geometry.type === "Point") {
    const [x, y] = geometry.coordinates;
    return { selection: pointSelection(map, settlement.spaceId, [x, y]), city };
  }
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
  return {
    city,
    selection: {
      parent: map.reference,
      spaceId: settlement.spaceId,
      geometry: geometry as RegionGeometry,
      featureIds: [settlement.id],
      regionPath: [],
    },
  };
}

/** A city map's district opens as a real-scale map over its own outline. */
export function districtSelection(
  map: MapDescriptor,
  district: PublishedFeature
): RegionSelection | null {
  if (district.kind !== "district") return null;
  const { geometry } = district;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
  const outline = geometry as RegionGeometry;
  return {
    parent: map.reference,
    spaceId: district.spaceId,
    geometry: outline,
    featureIds: [],
    regionPath: [
      {
        id: district.id,
        name: district.name,
        spaceId: district.spaceId,
        parentId: null,
        geometry: outline,
        child: null,
      },
    ],
  };
}

/** A district map is drawn with town-scale hexes across the whole district. */
export const districtChoice: RealScaleChoice = {
  kind: "ground",
  hexSize: "30m",
  hexesAcross: 200,
};
