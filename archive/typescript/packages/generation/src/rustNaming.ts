import type { Entity, Position, World } from "@atlas/domain";
import type { Geometry } from "geojson";
import { createRNG, pickWeighted } from "@atlas/name-forge";
import { atlasName, nameGeographicFeature, nameMetadata, namingCulture } from "./atlasNaming";
import type { TraditionKind } from "./human/traditions";

type Point = Pick<Position, "x" | "y">;
interface Geographic {
  id: string;
  kind: string;
  geometry: Geometry;
  attributes: Record<string, unknown>;
}
type Request =
  | ({ method: "geographic" } & Geographic)
  | ({ method: "inhabited"; speakers: [string, number][]; era: string } & Geographic)
  | { method: "magic"; id: string; kind: string; term: string; position: Point }
  | { method: "community"; id: string; position: Point; language: string | null; era: string }
  | {
      method: "tradition";
      id: string;
      kind: TraditionKind;
      position: Point;
      language: string | null;
      era: string;
    }
  | { method: "culture"; position: Point }
  | { method: "entity"; entity: Entity };

function result(named: ReturnType<typeof nameGeographicFeature>) {
  return named ? { name: named.name, metadata: nameMetadata(named) } : null;
}
function inhabited(world: World, request: Extract<Request, { method: "inhabited" }>) {
  const spoken = request.speakers
    .filter(([, people]) => people > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const language = spoken.length
    ? pickWeighted(
        createRNG(JSON.stringify([world.seed, "naming-language", request.id])),
        spoken.map(([tongue]) => tongue),
        spoken.map(([, people]) => people)
      )
    : null;
  const named = result(
    nameGeographicFeature(world, request.id, request.kind, request.geometry, request.attributes, {
      language,
      era: request.era,
    })
  );
  return named ? { named, language } : null;
}
function dispatch(world: World, request: Request): unknown {
  switch (request.method) {
    case "geographic":
      return result(
        nameGeographicFeature(world, request.id, request.kind, request.geometry, request.attributes)
      );
    case "inhabited":
      return inhabited(world, request);
    case "magic":
      return result(
        atlasName(world, {
          key: request.id,
          kind: "magic",
          subkind: request.kind,
          term: request.term,
          position: request.position,
        })
      );
    case "community":
      return result(
        atlasName(world, {
          key: request.id,
          kind: "settlement",
          position: request.position,
          language: request.language,
          era: request.era,
        })
      );
    case "tradition":
      return result(
        atlasName(world, {
          key: request.id,
          position: request.position,
          language: request.language,
          era: request.era,
          ...traditionKind(request.kind),
        })
      );
    case "culture":
      return namingCulture(world, request.position).id;
    case "entity":
      world.entities[request.entity.id] = request.entity;
      return null;
  }
}
function traditionKind(kind: TraditionKind) {
  return kind === "allegiance"
    ? { kind: "polity" as const, subkind: "commonwealth", term: "Commonwealth" }
    : { kind: "culture" as const };
}
/** A private run-local naming world, shared by browser and native callers. */
export function rustNaming(world: World) {
  const namingWorld = { ...world, entities: { ...world.entities } };
  return { name: (request: string) => JSON.stringify(dispatch(namingWorld, JSON.parse(request))) };
}
