import { spatial, type Position } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { Area, AtlasFeature, World } from "./types";
import type { DrawingTool } from "./cartography";

export interface DrawingOptions {
  name: string;
  entityId: string;
  attributes: Record<string, unknown>;
}
export function drawnFeature(
  world: World,
  area: Area,
  geometry: Geometry,
  tool: DrawingTool,
  options: DrawingOptions
): AtlasFeature {
  const count = (world.featureCount ?? 0) + 1;
  const feature: AtlasFeature = {
    id: crypto.randomUUID(),
    areaId: area.id,
    name: options.name.trim() || `${tool.kind.replace(/([A-Z])/g, " $1")} ${count}`,
    kind: tool.kind,
    layerId: tool.layer,
    geometry,
    detail: {},
    attributes: {
      ...booleanDefaults(world.layers[tool.layer]?.schema ?? {}),
      ...options.attributes,
    },
    relations: [],
    state: "authored",
    protected: true,
    actor: "user",
    generationId: null,
    causes: [],
  };
  const relation = {
    sovereignty: "sovereign",
    administration: "administeredBy",
    claim: "claimedBy",
    control: "controlledBy",
  }[tool.kind];
  if (relation && options.entityId)
    feature.relations = [{ targetId: options.entityId, kind: relation }];
  return feature;
}
function booleanDefaults(schema: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([, spec]) => (spec as { type: string }).type === "boolean")
      .map(([name]) => [name, false])
  );
}
export function regionExtent(area: Area, geometry: Geometry): Geometry {
  const clipped = spatial.intersection(area.footprint, geometry);
  if (!clipped || !["Polygon", "MultiPolygon"].includes(clipped.type))
    throw new Error("Draw an area inside its geographic parent.");
  return clipped;
}
export function sourceFootprint(geometry: Geometry): { source: Position; radius: number } {
  const [x0, y0, x1, y1] = spatial.bounds(geometry);
  return { source: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 0 }, radius: (x1 - x0) / 2 };
}
export function landmarkInput(landmark: World["landmarks"][number]) {
  return {
    id: landmark.id,
    name: landmark.name,
    kind: landmark.kind,
    geometry: landmark.geometry,
    parameters: landmark.parameters,
    emplacedAtEpoch: landmark.emplacedAtEpoch,
    origin: landmark.origin,
  };
}
export function magicInput(source: World["magic"][number]) {
  return {
    id: source.id,
    name: source.name,
    source: source.source,
    radius: source.radius,
    strength: source.strength,
    propagation: source.propagation,
    effect: source.effect,
    decay: source.decay,
    storage: source.storage,
    dependsOn: source.dependsOn,
    startsAtEpoch: source.startsAtEpoch,
  };
}
