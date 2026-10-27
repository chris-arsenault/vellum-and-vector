import type {
  AtlasFeature,
  DomainSnapshot,
  DomainWrite,
  ObjectKind,
  FeatureReader,
  NetworkReader,
} from "@atlas/domain";
import { worldNetworkReader } from "@atlas/domain";

/** Iterate record values without making another array or index of all generated features. */
export function* snapshotRecords(
  snapshot: DomainSnapshot,
  features?: Iterable<AtlasFeature>,
  networks?: NetworkReader
): IterableIterator<DomainWrite> {
  const w = snapshot.world;
  for (const id in w.areas) yield { kind: "area", value: w.areas[id] };
  for (const id in w.layers) yield { kind: "layer", value: w.layers[id] };
  for (const id in w.entities) yield { kind: "entity", value: w.entities[id] };
  yield* featureRecords(snapshot, features);
  for (const id in w.connections) yield { kind: "connection", value: w.connections[id] };
  const graph = networks ?? worldNetworkReader(w);
  for (const value of graph.nodes()) yield { kind: "node", value };
  for (const value of graph.reaches()) yield { kind: "reach", value };
  yield* listedRecords(snapshot);
  yield* geographicState(snapshot);
}
function* featureRecords(
  snapshot: DomainSnapshot,
  features?: Iterable<AtlasFeature>
): IterableIterator<DomainWrite> {
  if (features) for (const feature of features) yield { kind: "feature", value: feature };
  else
    for (const id in snapshot.world.features)
      yield { kind: "feature", value: snapshot.world.features[id] };
}
function* listedRecords(snapshot: DomainSnapshot): IterableIterator<DomainWrite> {
  const w = snapshot.world;
  for (const value of w.fields)
    yield { kind: "field", value: { ...value, resourceId: value.resourceId! } };
  for (const value of w.magic) yield { kind: "magic", value };
  for (const value of w.landmarks ?? []) yield { kind: "landmark", value };
  for (const value of w.views) yield { kind: "view", value };
  for (const value of snapshot.coverage) yield { kind: "coverage", value };
  for (const value of snapshot.fieldPatches) yield { kind: "fieldPatch", value };
}
function* geographicState(snapshot: DomainSnapshot): IterableIterator<DomainWrite> {
  for (const id in snapshot.world.societies) {
    const value = snapshot.world.societies[id];
    yield { kind: "society", value: { ...value, id: `society:${value.areaId}` } };
  }
  for (const id in snapshot.world.drainage) {
    const value = snapshot.world.drainage[id];
    yield { kind: "drainage", value: { ...value, id: `drainage:${value.areaId}` } };
  }
}
/** Semantic dictionaries already index the large collections; do not build a second Map. */
export function snapshotRecordValue(
  snapshot: DomainSnapshot,
  kind: ObjectKind,
  id: string,
  features?: FeatureReader,
  networks?: NetworkReader
) {
  if (features && kind === "feature") return features.get(id);
  if (networks && kind === "node") return networks.node(id);
  if (networks && kind === "reach") return networks.reach(id);
  const w = snapshot.world;
  const dictionaries: Partial<Record<ObjectKind, Record<string, DomainWrite["value"]>>> = {
    area: w.areas,
    layer: w.layers,
    entity: w.entities,
    feature: w.features,
    connection: w.connections,
    node: w.networkNodes,
    reach: w.networkReaches,
  };
  return dictionaries[kind]?.[id] ?? listedRecordValue(snapshot, kind, id);
}
function listedRecordValue(snapshot: DomainSnapshot, kind: ObjectKind, id: string) {
  const w = snapshot.world;
  const lists: Partial<Record<ObjectKind, { id: string }[]>> = {
    field: w.fields,
    magic: w.magic,
    landmark: w.landmarks,
    view: w.views,
    coverage: snapshot.coverage,
    fieldPatch: snapshot.fieldPatches,
  };
  if (lists[kind]) return lists[kind]!.find((value) => value.id === id);
  if (kind !== "society" && kind !== "drainage") return undefined;
  const value = kind === "society" ? w.societies?.[id.slice(8)] : w.drainage?.[id.slice(9)];
  return value ? { ...value, id } : undefined;
}
