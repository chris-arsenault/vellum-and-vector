import {
  areaSpace,
  layerSupports,
  polygonGeometry,
  spatial,
  compactGeometryBounds,
  fieldCategories,
  mapRefinementLevel,
  minimumRegionWidthMetres,
  regionalSelectionArea,
  regionalSubdivisionCount,
  type DomainSnapshot,
  type EpochHistory,
  type FeatureReader,
  type GridSurface,
} from "@atlas/domain";
import type { MapDescriptor, MapLayer, MapRef, MapSample, RasterBand } from "@atlas/map";
import type { MapProductInput } from "./mapProductPublication";
import { mapFeatureRecords, vectorLayerId } from "./mapFeaturePublication";
import { mapHistoryRecords } from "./mapHistoryPublication";
import { mapSnapshotChannels, mapSnapshotRasters } from "./mapSnapshotRasters";
import { mapSampleRecords } from "./mapSamplePublication";
import { rasterLayerId } from "./mapRasterPublication";
import { categoryPalette } from "./rasterPresentation";
import { mapSnapshotSpaces } from "./mapSnapshotSpaces";
import { inspectionCatalog, vectorCatalog } from "./mapLayerCatalog";
import { shownUnit } from "./fieldNames";
import { fieldLabel } from "./rasterPresentation";
import { mapIllustrationGeometry } from "./mapIllustrationPublication";
import { mapEntities } from "./mapCataloguePublication";

interface PublicationIdentity {
  reference: MapRef;
  expected: MapRef | null;
  parent: MapRef | null;
}
/** Assemble the completed snapshot's map product before its working fields are released. */
export function mapSnapshotProduct(
  snapshot: DomainSnapshot,
  identity: PublicationIdentity,
  features: FeatureReader,
  history: EpochHistory[]
): MapProductInput {
  const { world, scope } = snapshot;
  const area = world.areas[scope.areaId];
  const footprint = polygonGeometry(area.footprint);
  if (!footprint) throw new Error("A map requires polygon geography.");
  const spaceId = areaSpace(world, area.id);
  const bounds =
    spaceId === world.id
      ? compactGeometryBounds(world.reference, footprint)
      : spatial.bounds(footprint);
  const descriptor: MapDescriptor = {
    reference: identity.reference,
    worldId: world.id,
    name: area.name,
    primarySpaceId: spaceId,
    profile: area.profile,
    regionScale: {
      level: mapRefinementLevel(world.areas, area.id),
      nextArea: regionalSelectionArea(mapRefinementLevel(world.areas, area.id) + 1),
      subdivision: regionalSubdivisionCount,
      minimumWidth: minimumRegionWidthMetres(area.footprint),
      enabled: area.profile !== "interior" && area.context !== "cave" && area.frame.floor === null,
    },
    footprint: footprint as MapDescriptor["footprint"],
    bounds,
    spaces: mapSnapshotSpaces(world, area.id),
    parent: identity.parent,
    state: "incomplete",
    layers: vectorLayers(snapshot, bounds, features),
  };
  const inspection = inspectionLayer(snapshot, bounds);
  if (inspection) descriptor.layers.push(inspection);
  return {
    world,
    descriptor,
    expected: identity.expected,
    progressive: identity.expected === null,
    rasters: (async function* () {
      yield* mapSnapshotRasters(snapshot, area.id, () =>
        mapFeatureRecords(world, area.id, features, "lakes")
      );
    })(),
    async *features(layerId) {
      const source = Object.keys(world.layers).find((id) => vectorLayerId(id) === layerId);
      if (!source) throw new Error(`Unknown published vector layer ${layerId}.`);
      yield* mapFeatureRecords(world, area.id, features, source);
    },
    samples: (layers) => snapshotSamples(snapshot, layers),
    history: mapHistoryRecords(history, identity.reference.revision),
    entities: mapEntities(world),
    illustration: () => mapIllustrationGeometry(snapshot, features),
  };
}
function vectorLayers(
  snapshot: DomainSnapshot,
  bounds: MapDescriptor["bounds"],
  features: FeatureReader
): MapLayer[] {
  const { world, scope } = snapshot;
  return Object.values(world.layers)
    .filter(
      (layer) =>
        layer.profiles.includes(world.areas[scope.areaId].profile) &&
        (layerSupports(layer, "vector") || layerSupports(layer, "network"))
    )
    .map((layer) => ({
      id: vectorLayerId(layer.id),
      name: layer.name,
      spaceId: scope.spaceId,
      bounds,
      attribution: [],
      catalog: vectorCatalog(world, scope.areaId, layer.id, features),
      source: {
        kind: "vector",
        data: { assetId: crypto.randomUUID(), mediaType: "application/geo+json" },
      },
    }));
}
function inspectionLayer(
  snapshot: DomainSnapshot,
  bounds: MapDescriptor["bounds"]
): MapLayer | null {
  const bands: RasterBand[] = [];
  for (const [channel, field] of mapSnapshotChannels(snapshot, snapshot.scope.areaId)) {
    const grid = snapshot.numerical[field.id];
    if (!grid?.channels[channel])
      throw new Error(`Load ${field.id}:${channel} before map publication.`);
    const unit = grid.units[channel]!;
    if (!channel.startsWith("magicApplied:") && unit !== "cell-index") continue;
    bands.push({
      id: channel,
      name: fieldLabel(snapshot.world, channel),
      unit,
      display: shownUnit(unit),
      nodata: null,
      range: null,
      categories: (categoryPalette(snapshot.world, channel) ?? []).map((category) => ({
        value: category.code,
        label: category.name,
        color: category.color,
        present: fieldCategories(grid, channel, snapshot.scope.footprint).includes(category.code),
        surface: null,
      })),
    });
  }
  return bands.length
    ? {
        id: "inspection",
        name: "Stored map facts",
        spaceId: snapshot.scope.spaceId,
        bounds,
        attribution: [],
        catalog: inspectionCatalog(),
        source: { kind: "attributes", data: { bands } },
      }
    : null;
}
function* snapshotSamples(snapshot: DomainSnapshot, layers: MapLayer[]): Generator<MapSample> {
  const groups = new Map<GridSurface["active"], GridSurface<string>>();
  for (const [channel, field] of mapSnapshotChannels(snapshot, snapshot.scope.areaId)) {
    const grid = snapshot.numerical[field.id];
    let group = groups.get(grid.active);
    if (!group) {
      group = { ...grid, channels: {}, units: {}, quantities: {} };
      groups.set(grid.active, group);
    }
    group.channels[channel] = grid.channels[channel];
    group.units[channel] = grid.units[channel];
    group.quantities![channel] = grid.quantities?.[channel] ?? "intensive";
  }
  let ordinal = 0;
  for (const grid of groups.values()) {
    const bindings = Object.keys(grid.channels).map((channel) => {
      const raster = layers.find((layer) => layer.id === rasterLayerId(channel));
      const layer = raster ?? layers.find((layer) => layer.id === "inspection");
      if (!layer) throw new Error(`Map inspection is missing its ${channel} layer.`);
      return { channel, layer, bandId: raster ? "value" : channel };
    });
    for (const sample of mapSampleRecords(snapshot.world, grid, bindings))
      yield {
        ...sample,
        id: `${ordinal}:${sample.id}`,
        sections: sample.sections.map((section) => ({
          ...section,
          id: `${ordinal}:${section.id}`,
        })),
      };
    ordinal++;
  }
}
