import {
  areaSpace,
  geographyAreas,
  semanticId,
  spatial,
  layerSupports,
  polygonGeometry,
  type Area,
  type AtlasFeature,
  type CatalogChanges,
  type DomainSnapshot,
  type DomainWrite,
  type SpatialStore,
} from "@atlas/domain";
import type { FieldInputStore } from "@atlas/storage-browser";
import { captureMapFields } from "./mapCaptureFields";

/** One-time import: after this commit parent geography is only provenance. */
export async function captureMap(
  catalog: SpatialStore & Pick<import("@atlas/storage-browser").SpatialCatalog, "readEditor">,
  resources: FieldInputStore,
  source: DomainSnapshot,
  area: Area,
  publication: CatalogChanges
) {
  const world = await catalog.readEditor(source.world.id),
    sourceId = source.scope.areaId === area.id ? area.id : area.map!.sourceAreaId,
    owners = geographyAreas(world, sourceId),
    scope = { ...source.scope, areaId: sourceId, footprint: area.footprint },
    captured = await captureContextSnapshot(catalog, scope, world, owners);
  const features = await captureFeatures(catalog, scope, area);
  const ids = new Map(
    features.map((f) => [
      f.id,
      f.areaId === area.id
        ? f.id
        : semanticId(world.id, `map:${area.id}:feature`, f.placeId ?? f.id),
    ])
  );
  const seen = new Set<string>();
  const put = (data: DomainWrite) => {
    const key = `${data.kind}:${data.value.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    publication.writes.push({
      scope: { worldId: world.id, areaId: area.id, spaceId: areaSpace(world, sourceId) },
      reference: {
        kind: data.kind,
        id: data.value.id!,
        revision:
          source.revisions.find((r) => r.kind === data.kind && r.id === data.value.id)?.version ??
          0,
      },
      data,
    });
  };
  const clip = spatial.intersectionWith(area.footprint);
  for (const feature of features) {
    // Sources have a synthetic display feature; the captured magic record owns it.
    if (captured.world.magic.some((entry) => entry.id === feature.id)) continue;
    const local = capturedFeature(feature, area, ids, sourceId === area.id, clip);
    if (!local) continue;
    put({ kind: "feature", value: local });
    if (layerSupports(world.layers[local.layerId], "network"))
      captureNetwork(local, put, world.id, area);
  }
  captureContext(captured, area, owners, ids, put);
  await captureMapFields(
    catalog,
    resources,
    source,
    area,
    world.fields.filter((field) => owners.includes(field.areaId)),
    publication
  );
  captureReadSet(captured, publication);
}
function captureContextSnapshot(
  catalog: SpatialStore,
  scope: DomainSnapshot["scope"],
  world: DomainSnapshot["world"],
  owners: string[]
) {
  return catalog.readAuthoring({
    scope,
    objects: [
      { kind: "society", ids: owners.map((id) => `society:${id}`) },
      { kind: "drainage", ids: owners.map((id) => `drainage:${id}`) },
      {
        kind: "magic",
        ids: world.magic.filter((s) => owners.includes(s.areaId ?? scope.areaId)).map((s) => s.id),
      },
      {
        kind: "landmark",
        ids: world.landmarks
          .filter((s) => owners.includes(s.areaId ?? scope.areaId))
          .map((s) => s.id),
      },
    ],
    channels: [],
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
  });
}
function capturedFeature(
  feature: AtlasFeature,
  area: Area,
  ids: Map<string, string>,
  converting: boolean,
  clip: ReturnType<typeof spatial.intersectionWith>
): AtlasFeature | null {
  const clipped = clip(feature.geometry),
    geometry = feature.geometry.type.includes("Polygon") ? polygonGeometry(clipped) : clipped;
  if (!geometry) return null;
  const local = {
    ...structuredClone(feature),
    // Source authorship is provenance; only this map's existing drawings remain constraints.
    ...(converting ? {} : { state: "generated" as const, protected: false, mapOnly: undefined }),
    id: ids.get(feature.id)!,
    placeId: feature.placeId ?? feature.id,
    areaId: area.id,
    geometry,
    detail: {},
    attributes: {
      ...feature.attributes,
      ...(feature.kind === "landmark" ? { causeId: `landmark:${ids.get(feature.id)!}` } : {}),
    },
    relations: feature.relations
      .filter((r) => !["follows", "dependsOn"].includes(r.kind) || ids.has(r.targetId))
      .map((r) => ({ ...r, targetId: ids.get(r.targetId) ?? r.targetId })),
  };
  delete local.footprint;
  const footprint = feature.footprint && polygonGeometry(clip(feature.footprint));
  if (footprint) local.footprint = footprint;
  return local;
}
async function captureFeatures(catalog: SpatialStore, scope: DomainSnapshot["scope"], area: Area) {
  const features: AtlasFeature[] = [];
  let after: string | null = null;
  do {
    const page = await catalog.readFeatures({
      scope,
      extent: spatial.bounds(area.footprint),
      layers: [],
      after,
      limit: 128,
      predicate: "intersects",
      geometry: area.footprint,
    });
    features.push(...page.records.map((r) => r.feature));
    after = page.next;
  } while (after);
  return features;
}
function captureReadSet(captured: DomainSnapshot, publication: CatalogChanges) {
  const existing = new Set(publication.expected.map((r) => `${r.kind}:${r.id}`));
  for (const reference of [
    ...captured.revisions.map((r) => ({ kind: r.kind, id: r.id, revision: r.version })),
    ...publication.writes.map((w) => w.reference),
  ]) {
    const key = `${reference.kind}:${reference.id}`;
    if (!existing.has(key)) {
      publication.expected.push(reference);
      existing.add(key);
    }
  }
}
function captureContext(
  source: DomainSnapshot,
  area: Area,
  owners: string[],
  ids: Map<string, string>,
  put: (data: DomainWrite) => unknown
) {
  const world = source.world,
    society = owners.map((id) => world.societies?.[id]).find(Boolean),
    drainage = owners.map((id) => world.drainage?.[id]).find(Boolean);
  if (society)
    put({
      kind: "society",
      value: {
        ...structuredClone(society),
        id: `society:${area.id}`,
        areaId: area.id,
        ...(society.areaId !== area.id ? { capturedFrom: society.areaId } : {}),
      },
    });
  if (drainage)
    put({
      kind: "drainage",
      value: {
        ...structuredClone(drainage),
        id: `drainage:${area.id}`,
        areaId: area.id,
        reaches: captureDrainage(drainage.reaches, area, ids),
      },
    });
  const landmarks = world.landmarks.filter((l) => spatial.intersects(l.geometry, area.footprint)),
    magic = world.magic.filter((m) =>
      spatial.intersects(
        spatial.buffer({ type: "Point", coordinates: [m.source.x, m.source.y] }, m.radius)!,
        area.footprint
      )
    ),
    localId = (kind: string, record: { id: string; areaId?: string }) =>
      record.areaId === area.id
        ? record.id
        : (ids.get(record.id) ?? semanticId(world.id, `map:${area.id}:${kind}`, record.id)),
    landmarkIds = new Map(landmarks.map((l) => [l.id, localId("landmark", l)])),
    magicIds = new Map(magic.map((m) => [m.id, localId("magic", m)]));
  for (const landmark of landmarks) {
    put({
      kind: "landmark",
      value: {
        ...landmark,
        id: landmarkIds.get(landmark.id)!,
        areaId: area.id,
      },
    });
  }
  for (const entry of magic) {
    put({
      kind: "magic",
      value: {
        ...entry,
        id: magicIds.get(entry.id)!,
        landmarkId: entry.landmarkId ? landmarkIds.get(entry.landmarkId) : undefined,
        dependsOn: entry.dependsOn?.flatMap((id) => magicIds.get(id) ?? []) ?? null,
        areaId: area.id,
      },
    });
  }
}
function captureDrainage(
  reaches: import("@atlas/domain").DrainageReach[],
  area: Area,
  ids: Map<string, string>
) {
  const kept = reaches
      .map((reach, index) => ({ reach, index }))
      .filter(({ reach }) =>
        spatial.intersects({ type: "LineString", coordinates: reach.coordinates }, area.footprint)
      ),
    indexes = new Map(kept.map(({ index }, i) => [index, i]));
  return kept.map(({ reach }) => ({
    ...reach,
    downstream: reach.downstream === null ? null : (indexes.get(reach.downstream) ?? null),
    featureIds: reach.featureIds.flatMap((id) => ids.get(id) ?? []),
  }));
}
function captureNetwork(
  feature: AtlasFeature,
  put: (data: DomainWrite) => unknown,
  worldId: string,
  area: Area
) {
  const geometry = feature.geometry,
    lines =
      geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : [];
  for (const [part, coordinates] of lines.entries()) {
    const ends = [coordinates[0], coordinates.at(-1)!],
      nodes = ends.map(([x, y, z = 0]) => ({
        id: semanticId(worldId, `map:${area.id}:node`, `${feature.layerId}:${x}:${y}`),
        kind: `network:${feature.layerId}`,
        position: { x, y, z },
        spaceId: area.spaceId!,
        waterLevel: null,
      }));
    for (const node of nodes) put({ kind: "node", value: node });
    put({
      kind: "reach",
      value: {
        id: semanticId(worldId, `map:${area.id}:reach`, `${feature.id}:${part}`),
        featureId: feature.id,
        start: nodes[0].id,
        end: nodes[1].id,
        geometry: { type: "LineString", coordinates },
        flow: Number(feature.attributes.discharge ?? 0),
        endFlow: null,
      },
    });
  }
}
