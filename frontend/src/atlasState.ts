import {
  areaSpace,
  createWorldBlueprint,
  canonryConfluencePresets,
  canonryMagicPresets,
  FactDependencies,
  requireThat,
  rectangle,
  type DomainSnapshot,
  type History,
  type ObjectKind,
  type SpatialScope,
  type World,
} from "@atlas/domain";
import {
  defaultHumanEras,
  generationSettingsSchema,
  type GenerationSettings,
} from "@atlas/generation";

export interface SessionWorld {
  snapshot: DomainSnapshot;
  history: History[];
  undo: DomainSnapshot[];
  causes: Record<string, import("@atlas/generation").EpochHistory[]>;
}

const worlds = new Map<string, SessionWorld>();
type Change = "world" | "jobs" | "templates";
const listeners = new Set<(change: Change) => void>();
export const facts = new FactDependencies()
  .add("elevation", ["climate", "rivers", "lakes", "roads", "cultures", "sovereignty"])
  .add("climate", ["rivers", "cultures"])
  .add("rivers", ["roads", "cultures", "sovereignty"]);

export function subscribe(listener: (change: Change) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function changed(change: Change = "world") {
  for (const listener of listeners) listener(change);
}
export function session(id: string): SessionWorld {
  const value = worlds.get(id);
  requireThat(value, "missing_world", "Choose a world in this session.");
  return value;
}
export function worldScope(world: World, areaId: string): SpatialScope {
  const area = world.areas[areaId];
  requireThat(area, "missing_area", "Choose an existing mapped area.");
  return {
    worldId: world.id,
    areaId,
    spaceId: areaSpace(world, areaId),
    crsId: world.reference.id,
    footprint: area.footprint,
    revision: world.version,
    time: "present",
    resolution: null,
  };
}

export function indexSnapshot(snapshot: DomainSnapshot): DomainSnapshot {
  const world = snapshot.world;
  const stores: [ObjectKind, { id: string }[]][] = [
    ["area", Object.values(world.areas)],
    ["feature", Object.values(world.features)],
    ["entity", Object.values(world.entities)],
    ["layer", Object.values(world.layers)],
    ["field", world.fields],
    ["magic", world.magic],
    ["landmark", (world.landmarks ??= [])],
    ["view", world.views],
    ["connection", Object.values(world.connections ?? {})],
    ["node", Object.values(world.networkNodes ?? {})],
    ["reach", Object.values(world.networkReaches ?? {})],
  ];
  snapshot.revisions = stores.flatMap(([kind, objects]) =>
    objects.map(({ id }) => ({
      kind,
      id,
      revisionId: id,
      version: world.version,
    }))
  );
  snapshot.identities = {
    ...snapshot.identities,
    ...Object.fromEntries(snapshot.revisions.map((r) => [r.id, r.kind])),
  };
  world.featureCount = Object.keys(world.features).length;
  return snapshot;
}

export interface WorldCreationInput {
  boundaryMode?: World["reference"]["boundaryMode"];
  name: string;
  seed: number;
  width: number;
  height: number;
  settings?: GenerationSettings;
}
export function createWorld(input: WorldCreationInput) {
  return registerWorldSnapshot(createWorldSnapshot(input));
}
export function registerWorldSnapshot(snapshot: DomainSnapshot) {
  const world = snapshot.world;
  requireThat(
    !worlds.has(world.id),
    "existing_world",
    "This world is already registered in the session."
  );
  worlds.set(world.id, { snapshot, history: [], undo: [], causes: {} });
  changed();
  return world;
}
export function restoreSessionWorld(saved: SessionWorld) {
  // Maps saved before landmarks existed carry no array; the record is otherwise unchanged.
  saved.snapshot.world.landmarks ??= [];
  worlds.set(saved.snapshot.world.id, saved);
  changed();
}
export function createWorldSnapshot(input: WorldCreationInput, id: string = crypto.randomUUID()) {
  requireThat(
    Number.isFinite(input.width) &&
      input.width > 0 &&
      Number.isFinite(input.height) &&
      input.height > 0,
    "world_size",
    "World dimensions must be positive finite metres."
  );
  const blueprint = createWorldBlueprint({
    id,
    name: input.name,
    seed: input.seed,
    rootName: input.name,
    reference: {
      id: `world:${id}`,
      domain: rectangle([0, 0, input.width, input.height]),
      topology: "planar",
      boundaryMode: input.boundaryMode ?? "none",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "Sea level",
      precision: 0.000001,
      version: 1,
    },
  });
  const world: World = {
    id,
    name: blueprint.name,
    seed: blueprint.seed,
    version: 1,
    owner: "creator",
    reference: blueprint.reference,
    areas: { [blueprint.root.id]: blueprint.root },
    layers: Object.fromEntries(blueprint.layers.map((layer) => [layer.id, layer])),
    features: {},
    fields: [],
    entities: {},
    templates: {},
    magic: [],
    landmarks: [],
    magicSystems: canonryMagicPresets(),
    confluences: canonryConfluencePresets(),
    views: [],
    generations: [],
    epochs: defaultEpochs(),
    humanEras: defaultHumanEras(),
  };
  if (input.settings) Object.assign(world, generationSettingsSchema.parse(input.settings));
  const snapshot = indexSnapshot({
    world,
    scope: worldScope(world, blueprint.root.id),
    numerical: {},
    resources: [],
    revisions: [],
    identities: {},
    coverage: [],
    fieldPatches: [],
  });
  return snapshot;
}
export function defaultEpochs(): World["epochs"] {
  return [
    {
      id: "Formation",
      tectonics: 1,
      hydrology: 1,
      ice: 0,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
    {
      id: "Cold age",
      tectonics: 0.4,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: -3,
      seaLevel: -40,
    },
    {
      id: "Present",
      tectonics: 0.1,
      hydrology: 1,
      ice: 0,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
}

export function listWorlds() {
  return [...worlds.values()].map(({ snapshot: { world } }) => ({
    id: world.id,
    name: world.name,
    version: world.version,
  }));
}
export function publish(id: string, snapshot: DomainSnapshot, kind: string, operationId: string) {
  const entry = session(id);
  entry.undo.push(entry.snapshot);
  entry.snapshot = indexSnapshot(snapshot);
  entry.history.unshift({
    operationId,
    version: snapshot.world.version,
    actor: kind === "generate" ? "generator" : "user",
    kind,
    at: new Date().toISOString(),
  });
  changed();
}
export function undoWorld(id: string, operationId: string) {
  const entry = session(id);
  requireThat(
    entry.history[0]?.operationId === operationId,
    "undo_order",
    "Undo the most recent operation first."
  );
  const previous = entry.undo.pop();
  requireThat(previous, "nothing_to_undo", "There are no earlier edits in this session.");
  const world = { ...previous.world, version: entry.snapshot.world.version + 1 };
  entry.snapshot = indexSnapshot({ ...previous, world });
  entry.history.shift();
  changed();
  return world;
}
