import type { AtlasFeature, Template } from "./types";
import { frameAt, rectangle } from "./presentation";

export const detached = "00000000-0000-0000-0000-000000000000";
export interface Item {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  space: string;
  original?: AtlasFeature;
}
export interface Floor {
  id: string;
  name: string;
  z: number;
}
export interface Drawing {
  items: Item[];
  floors: Floor[];
  size: { width: number; height: number };
  units: string;
}

export function mergeSockets(
  existing: NonNullable<Template["sockets"]>,
  features: AtlasFeature[],
  added: NonNullable<Template["sockets"]>
) {
  const ids = new Set(features.map((feature) => feature.id));
  return [...existing.filter((socket) => ids.has(socket.featureId)), ...added];
}

export function editable(feature: AtlasFeature) {
  return (
    ["room", "door", "stairs", "furniture"].includes(feature.kind) &&
    ["Point", "Polygon"].includes(feature.geometry.type)
  );
}
export function itemFromFeature(feature: AtlasFeature): Item {
  const points =
    feature.geometry.type === "Point"
      ? [feature.geometry.coordinates]
      : feature.geometry.type === "Polygon"
        ? feature.geometry.coordinates[0]
        : [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    id: feature.id,
    name: feature.name,
    kind: feature.kind,
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    space: feature.areaId,
    original: feature,
  };
}
export function buildDefinition(
  form: FormData,
  drawing: Drawing,
  editing: Template | null
): Template {
  const ownerName = String(form.get("owner"));
  const owners = ownerEntities(editing, ownerName);
  const features = drawing.items.map((item) =>
    itemFeature(item, drawing.items, owners[0], String(form.get("use")), templateUse(editing))
  );
  features.push(...(editing?.features.filter((f) => !editable(f)) ?? []));
  const base = editing ?? emptyTemplate(drawing);
  return {
    ...base,
    name: String(form.get("name")),
    features,
    units: drawing.units,
    frame: { ...base.frame, metresPerUnit: drawing.units === "foot" ? 0.3048 : 1 },
    sockets: managedAccess(
      mergeSockets(
        base.sockets ?? [],
        features,
        newSockets(drawing.items, form.get("bindAccess") === "on")
      ),
      drawing.items,
      form.get("bindAccess") === "on",
      !!base.requirements?.streetAccess
    ),
    requirements: requirements(form, base),
    entities: owners,
    recipe: recipe(form, base),
    spaces: drawing.floors
      .filter((f) => f.id !== detached)
      .map((f) => templateSpace(f, drawing, base)),
  };
}
export function templateUse(template: Template | null) {
  return String(template?.features[0]?.attributes.use ?? "tavern");
}
function managedAccess(
  sockets: NonNullable<Template["sockets"]>,
  items: Item[],
  required: boolean,
  previous: boolean
) {
  if (required === previous) return sockets;
  const door = items.find((i) => i.kind === "door" && i.space === detached);
  return sockets.map((socket) =>
    socket.featureId === door?.id && !socket.connectsTo ? { ...socket, required } : socket
  );
}
function emptyTemplate(drawing: Drawing): Template {
  return {
    id: crypto.randomUUID(),
    version: 1,
    name: "",
    profile: "interior",
    parentProfiles: ["site"],
    footprint: rectangle(0, 0, drawing.size.width, drawing.size.height),
    features: [],
    traits: [],
    frame: frameAt(0, 0),
  };
}
function itemFeature(
  item: Item,
  items: Item[],
  owner: NonNullable<Template["entities"]>[number] | undefined,
  use: string,
  previousUse: string
): AtlasFeature {
  const attributes = { ...item.original?.attributes };
  if (!item.original || use !== previousUse) attributes.use = use;
  const preserved = item.original ?? {
    layerId: "structures",
    geometry: itemGeometry(item),
    causes: [],
    relations: itemRelations(item, items, owner),
  };
  return {
    ...preserved,
    id: item.id,
    areaId: item.space,
    name: item.name,
    kind: item.kind,
    layerId: preserved.layerId,
    geometry: preserved.geometry,
    detail: {},
    attributes,
    state: "authored",
    protected: true,
    actor: "user",
    generationId: null,
    causes: preserved.causes,
    relations: preserved.relations,
  };
}
function itemGeometry(item: Item): AtlasFeature["geometry"] {
  return ["door", "stairs"].includes(item.kind)
    ? { type: "Point", coordinates: [item.x, item.y] }
    : rectangle(item.x, item.y, item.width, item.height);
}
function contains(room: Item, item: Item) {
  return (
    room.kind === "room" &&
    room.space === item.space &&
    room.id !== item.id &&
    item.x >= room.x - 0.01 &&
    item.x <= room.x + room.width + 0.01 &&
    item.y >= room.y - 0.01 &&
    item.y <= room.y + room.height + 0.01
  );
}
function itemRelations(
  item: Item,
  items: Item[],
  owner: NonNullable<Template["entities"]>[number] | undefined
) {
  const relations = items
    .filter((room) => contains(room, item))
    .map((room) => ({
      targetId: room.id,
      kind: item.kind === "furniture" ? "inside" : "connects",
    }));
  if (owner && item.kind === "room") relations.push({ targetId: owner.id, kind: "owner" });
  return relations;
}
function ownerEntities(editing: Template | null, name: string): NonNullable<Template["entities"]> {
  const existing = editing?.entities ?? [];
  if (!name) return existing;
  const owner = existing[0] ?? {
    id: crypto.randomUUID(),
    name,
    kind: "institution",
    attributes: {},
    relations: [],
  };
  return [{ ...owner, name }, ...existing.slice(1)];
}
function newSockets(items: Item[], bind: boolean): NonNullable<Template["sockets"]> {
  const entry = items.find((i) => i.kind === "door" && i.space === detached);
  return items
    .filter((i) => !i.original && ["door", "stairs"].includes(i.kind))
    .map((item) => {
      const peer = items.find(
        (other) =>
          item.kind === "stairs" &&
          other.kind === "stairs" &&
          other.space !== item.space &&
          other.x === item.x &&
          other.y === item.y
      );
      return {
        id: item.id,
        featureId: item.id,
        position: { x: item.x, y: item.y, z: 0 },
        kind: item.kind === "stairs" ? "vertical" : "entrance",
        required: bind && item.id === entry?.id,
        targetKinds: ["door", "entrance", "stairs", "road"],
        spaceId: item.space === detached ? null : item.space,
        connectsTo: peer?.id ?? null,
      };
    });
}
function requirements(form: FormData, base: Template): Template["requirements"] {
  return {
    contextKinds:
      form.get("structure") === "on"
        ? ["building"]
        : (base.requirements?.contextKinds?.filter((k) => k !== "building") ?? null),
    fields: base.requirements?.fields ?? null,
    maximumSlope: base.requirements?.maximumSlope ?? null,
    streetAccess: form.get("bindAccess") === "on",
  };
}
function recipe(form: FormData, base: Template): Template["recipe"] {
  return form.get("recipe") === "on"
    ? {
        domains: base.recipe?.domains ?? ["built"],
        seed: Number(form.get("seed")),
        quality: base.recipe?.quality ?? "standard",
      }
    : null;
}
function templateSpace(floor: Floor, drawing: Drawing, base: Template) {
  const source = base.spaces?.find((s) => s.id === floor.id);
  const frame = source?.frame ?? frameAt(0, 0);
  return {
    id: floor.id,
    name: floor.name,
    footprint: source?.footprint ?? rectangle(0, 0, drawing.size.width, drawing.size.height),
    frame: { ...frame, origin: { ...frame.origin, z: floor.z }, floor: floor.name },
  };
}
