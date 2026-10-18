import { randomUUID } from "node:crypto";
import {
  rectangle,
  representationId,
  type Area,
  type AtlasFeature,
  type LocatedRepresentation,
  type World,
} from "@atlas/domain";
import type { Sql } from "./database";
import { registerObjects } from "./database";
import { allocateRevisions } from "./revisions";
import { writeWorldHeader } from "./worldHeader";
import { writeArea } from "./areaWriter";
import { writeFeatureBases, writeLayers } from "./objectWriters";
import { writeRepresentations } from "./representations";
import { writeSpatialRows, type ComposedSpatialRow } from "./spatialRows";

function fixtureAreas(worldId: string, feature: string): [Area, Area] {
  const root: Area = {
    id: randomUUID(),
    name: "World",
    parentId: null,
    profile: "world",
    footprint: rectangle([0, 0, 100, 100]),
    frame: { origin: { x: 0, y: 0, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
    version: 1,
    traits: [],
    localTraits: [],
    layers: { rivers: "authored" },
    boundary: null,
    templateId: null,
    context: "landscape",
    spaceId: worldId,
  };
  const samples = [
    { x: 20, y: 20, z: 0 },
    { x: 80, y: 20, z: 0 },
    { x: 80, y: 80, z: 0 },
    { x: 20, y: 80, z: 0 },
  ].map((point) => ({ point, values: { elevation: 100 - point.x, temperature: 5 } }));
  const child: Area = {
    ...root,
    id: randomUUID(),
    name: "Valley",
    parentId: root.id,
    profile: "local",
    footprint: rectangle([20, 20, 80, 80]),
    frame: { origin: { x: 20, y: 20, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
    traits: [
      { field: "temperature", kind: "hard", minimum: -20, maximum: 20, cause: null, scope: null },
    ],
    localTraits: [],
    boundary: {
      version: 1,
      parentId: root.id,
      parentVersion: 1,
      samples,
      rings: [samples],
      epochs: [],
      history: [],
      waterFluxes: [],
      crossings: [
        {
          featureId: feature,
          point: { x: 20, y: 50, z: 80 },
          kind: "river",
          flow: 10,
          elevation: 80,
          direction: "incoming",
        },
        {
          featureId: feature,
          point: { x: 80, y: 50, z: 20 },
          kind: "river",
          flow: 10,
          elevation: 20,
          direction: "outgoing",
        },
      ],
    },
  };
  return [root, child];
}

function fixtureFeature(area: Area, id: string): AtlasFeature {
  return {
    id,
    name: "River",
    kind: "river",
    layerId: "rivers",
    areaId: area.id,
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 50],
        [100, 50],
      ],
    },
    detail: {},
    attributes: {
      elevations: [100, 0],
      discharges: [10, 10],
      tags: { empty: [], record: {}, nil: null },
      center: { x: 50, y: 50 },
      outletPath: [],
      history: [{ era: "ancient", action: "dam", cause: null }, { depth: 0 }],
      hypsometry: [{ floor: 0, area: 10, footprint: null }],
      epochHistory: [
        [],
        [{ epoch: "glacial", dissolution: 1, collapse: 0, deposition: 0, iceDamage: 2 }],
      ],
      waterExchange: { mechanism: "sluice", volume: 2, years: 1 },
    },
    relations: [],
    state: "authored",
    protected: true,
    actor: "user:alice",
    generationId: null,
    causes: [],
  };
}

export function fixtureComposed(
  world: string,
  feature: AtlasFeature,
  detail: LocatedRepresentation
): ComposedSpatialRow {
  if (detail.geometry.type !== "LineString") throw new Error("Fixture requires a directed line");
  return {
    featureId: feature.id,
    spaceId: world,
    layerId: feature.layerId,
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [
          [0, 50],
          [20, 50],
        ],
        detail.geometry.coordinates,
        [
          [80, 50],
          [100, 50],
        ],
      ],
    },
  };
}

function fixtureData() {
  const id = randomUUID(),
    featureId = randomUUID(),
    [root, child] = fixtureAreas(id, featureId);
  const feature = fixtureFeature(root, featureId),
    detail: LocatedRepresentation = {
      id: representationId(id, featureId, child.id),
      featureId,
      areaId: child.id,
      geometry: {
        type: "LineString",
        coordinates: [
          [20, 50],
          [35, 45],
          [65, 55],
          [80, 50],
        ],
      },
      state: "authored",
      actor: "user:alice",
      generationId: null,
      protected: true,
      needsReconciliation: false,
      attributes: { elevations: [80, 65, 35, 20], discharges: [10, 10, 10, 10] },
    };
  const layer = {
    id: "rivers",
    name: "Rivers",
    family: "water",
    representation: "network",
    color: "#71c4de",
    profiles: [root.profile, child.profile],
    schema: {},
    generator: null,
  };
  const world: World = {
    id,
    version: 1,
    name: "Atlas",
    seed: 42,
    owner: "alice",
    reference: {
      id: "fictional",
      domain: root.footprint,
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "sea",
      version: 1,
      precision: 0.000001,
    },
    areas: { [root.id]: root, [child.id]: child },
    features: { [feature.id]: feature },
    layers: { rivers: layer },
    entities: {},
    fields: [],
    templates: {},
    magic: [],
    epochs: [
      { id: "present", tectonics: 1, hydrology: 2, ice: 3, coasts: 4, temperature: 0, seaLevel: 0 },
    ],
    humanEras: [],
    generations: [],
    views: [],
    connections: {},
  };
  return { id, world, root, child, feature, detail, layer };
}

export async function seedSpatialWorld(sql: Sql) {
  const { id, world, root, child, feature, detail, layer } = fixtureData();
  await sql.query("INSERT INTO atlas_scopes VALUES($1,'alice','world')", [id]);
  await sql.query("INSERT INTO atlas_worlds(id,owner,name,version) VALUES($1,'alice','Atlas',1)", [
    id,
  ]);
  await writeWorldHeader(sql, world);
  await registerObjects(sql, id, [
    { id, kind: "world" },
    { id: root.id, kind: "area" },
    { id: child.id, kind: "area" },
    { id: feature.id, kind: "feature" },
  ]);
  const revisions = await allocateRevisions(sql, id, [
    root.id,
    child.id,
    feature.id,
    detail.id,
    layer.id,
  ]);
  await writeArea(sql, id, 1, revisions.get(root.id)!, root);
  await writeArea(sql, id, 1, revisions.get(child.id)!, child);
  await writeLayers(sql, id, 1, [{ revision: revisions.get(layer.id)!, value: layer }]);
  await writeFeatureBases(sql, id, 1, [{ revision: revisions.get(feature.id)!, value: feature }]);
  await writeRepresentations(sql, id, 1, [{ revision: revisions.get(detail.id)!, value: detail }]);
  await writeSpatialRows(sql, id, 1, [feature.id], [fixtureComposed(id, feature, detail)]);
  return { world, root, child, feature, detail, revisions };
}
