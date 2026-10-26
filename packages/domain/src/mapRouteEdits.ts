import type { Area, AtlasFeature } from "./model";
import type { DomainSnapshot, ChangeSet } from "./operations";
import { presentAtlasFeature } from "./featureReads";
import { representationId } from "./identity";
import { requireThat } from "./errors";
import { spatial } from "./spatial";
import { lineParts } from "./lineStations";
import { mappedBaseline } from "./mapEligibility";

export function writeMapRepresentation(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  area: Area,
  source: AtlasFeature,
  drawing: AtlasFeature,
  actor: string
) {
  changes.writes.push({
    kind: "representation",
    value: {
      id: source.detail[area.id]?.id ?? representationId(snapshot.world.id, source.id, area.id),
      featureId: source.id,
      areaId: area.id,
      geometry: drawing.geometry,
      attributes: drawing.attributes,
      ...(drawing.footprint ? { footprint: spatial.canonical(drawing.footprint) } : {}),
      state: "authored",
      protected: drawing.protected,
      needsReconciliation: false,
      actor,
      generationId: null,
      mapOnly: true,
      ...mappedBaseline(snapshot.world, source, area.id),
    },
  });
}

/** Community identifiers remain the link between a town symbol and its attached ways. */
export function moveMappedRoutes(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  area: Area,
  before: AtlasFeature,
  after: AtlasFeature,
  actor: string
) {
  if (before.geometry.type !== "Point" || after.geometry.type !== "Point") return;
  const communityId = before.attributes.communityId;
  if (!communityId) return;
  const destination = after.geometry.coordinates,
    original = before.geometry.coordinates;
  for (const source of Object.values(snapshot.world.features)) {
    if (!["road", "lane"].includes(source.kind)) continue;
    const drawing = presentAtlasFeature(snapshot.world, source, area.id);
    if (!drawing || !attachedWay(drawing, communityId)) continue;
    const local = spatial.intersection(drawing.geometry, area.footprint);
    if (!local) continue;
    const parts = lineParts(local).map((part) =>
      movedEndpoints(part, original, destination, snapshot.world.reference.precision ?? 1e-6)
    );
    const geometry =
      parts.length === 1
        ? { type: "LineString" as const, coordinates: parts[0] }
        : { type: "MultiLineString" as const, coordinates: parts };
    requireThat(
      spatial.covers(area.footprint, geometry),
      "mapped_route",
      "Keep the town's attached route inside its mapped area."
    );
    writeMapRepresentation(
      snapshot,
      changes,
      area,
      source,
      { ...drawing, geometry, protected: true },
      actor
    );
  }
}
function attachedWay(feature: AtlasFeature, communityId: unknown) {
  return (
    feature.geometry.type.includes("LineString") &&
    (feature.attributes.fromCommunity === communityId ||
      feature.attributes.toCommunity === communityId)
  );
}
function movedEndpoints(
  source: number[][],
  original: number[],
  destination: number[],
  precision: number
) {
  const coordinates = structuredClone(source);
  for (const index of [0, coordinates.length - 1])
    if (
      Math.hypot(coordinates[index][0] - original[0], coordinates[index][1] - original[1]) <=
      precision
    )
      coordinates[index] = [...destination];
  return coordinates;
}
