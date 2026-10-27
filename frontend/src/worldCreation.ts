import {
  areaSpace,
  createWorldBlueprint,
  canonryConfluencePresets,
  canonryMagicPresets,
  requireThat,
  rectangle,
  type DomainSnapshot,
  type SpatialScope,
  type World,
} from "@atlas/domain";
import {
  defaultHumanEras,
  generationSettingsSchema,
  type GenerationSettings,
} from "@atlas/generation";

export interface WorldCreationInput {
  boundaryMode?: World["reference"]["boundaryMode"];
  name: string;
  seed: number;
  width: number;
  height: number;
  settings?: GenerationSettings;
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
/** Initial domain values; the caller chooses the workspace that will own them. */
export function createWorldSnapshot(
  input: WorldCreationInput,
  id: string = crypto.randomUUID()
): DomainSnapshot {
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
    featureCount: 0,
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
  const revisions = [
    { kind: "area" as const, id: blueprint.root.id, revisionId: blueprint.root.id, version: 1 },
    ...blueprint.layers.map(({ id: layerId }) => ({
      kind: "layer" as const,
      id: layerId,
      revisionId: layerId,
      version: 1,
    })),
  ];
  return {
    world,
    scope: worldScope(world, blueprint.root.id),
    numerical: {},
    resources: [],
    revisions,
    identities: Object.fromEntries(revisions.map((r) => [r.id, r.kind])),
    coverage: [],
    fieldPatches: [],
  };
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
      seaLevel: 0,
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
