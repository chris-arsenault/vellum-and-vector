// Magic landmarks: a kept source of one system injected at the greatest strength its setting
// allows. The system's own origin, propagation, feedback and meetings act on it as on any
// source; the landmark holds only the intensity released at its site.
import { landmarkKind, landmarkKinds as catalogue, semanticId, type World } from "@atlas/domain";
import type { PhysicalField } from "./field";
import { clamp, round } from "./math";
import { nearestTriangle } from "./mesh";
import { distance, type Placed } from "./landmarkGeometry";
import type { Kind, LandmarkScene } from "./landmarkKind";
import { note } from "./landmarkLedger";

type Source = World["magic"][number];
const effects: Record<string, Source["effect"]> = {
  fire: "heat",
  aurora: "cold",
  pressure: "pressure",
  greenwood: "fertility",
  salt: "erosionResistance",
};

export const landmarkSourceId = (world: Pick<World, "id">, landmarkId: string) =>
  semanticId(world.id, "landmark-source", landmarkId);
/** The anchor cell and its neighbours: the intensity a source shows is read on real cells. */
function around(map: PhysicalField, placed: Placed) {
  const centre = nearestTriangle(map.mesh, ...placed.center);
  if (centre < 0) return [];
  const cells = [centre];
  for (let edge = 0; edge < map.mesh.degree[centre]; edge++) {
    const j = map.mesh.neighbors[centre * map.mesh.stride + edge];
    if (j >= 0 && distance(map, j, placed.center) <= map.mesh.spacing * 1.1) cells.push(j);
  }
  return cells;
}
function field(scene: LandmarkScene | undefined, system: string) {
  const found = scene?.magic?.fields.find((entry) => entry.definition.id === system);
  return found?.definition.enabled ? found : undefined;
}
/** The source's record in the run's world: created at emplacement, kept and adjusted after. */
function upsertSource(
  map: PhysicalField,
  placed: Placed,
  scene: LandmarkScene,
  system: string,
  strength: number,
  epoch: number
) {
  const { world, scope } = scene,
    id = landmarkSourceId(world, placed.landmark.id),
    [x0, y0] = map.mesh.origin,
    position = { x: placed.center[0] + x0, y: placed.center[1] + y0, z: 0 },
    previous = world.magic.find((source) => source.id === id);
  const source: Source = {
    id,
    landmarkId: placed.landmark.id,
    systemId: system,
    areaId: scope.areaId,
    spaceId: scope.spaceId,
    name: placed.landmark.name || (landmarkKind(placed.landmark.kind)?.label ?? system),
    source: position,
    radius: placed.parameters.reach * 1000,
    strength,
    propagation: "radial",
    effect: effects[system] ?? "heat",
    decay: 0,
    storage: 0,
    dependsOn: null,
    startsAtEpoch: previous ? Math.min(previous.startsAtEpoch, epoch) : epoch,
  };
  if (previous) Object.assign(previous, source);
  else world.magic.push(source);
  return source;
}
function magicKind(id: string, system: string): Kind {
  return {
    holdsLatent: true,
    emplace(map, _p, placed, epoch, record, scene) {
      if (!scene || !field(scene, system)) {
        if (record) note(record, `${system} is not generated in this run; no source formed.`);
        return;
      }
      const activity = Math.max(scene.activity(system), 1e-6),
        strength = clamp(Math.ceil(placed.parameters.intensity / activity), 50, 1000);
      upsertSource(map, placed, scene, system, strength, epoch);
      if (record) record.strength = strength;
    },
    measure(map, placed, _record, scene) {
      const live = field(scene, system);
      if (!live) return { intensity: NaN };
      const intensity = Math.max(...around(map, placed).map((i) => live.intensity[i]), 0);
      return { intensity: round(intensity) };
    },
    maintain(map, _p, placed, shortfall, epoch, record, scene) {
      const needed = shortfall.intensity ?? 0;
      if (!scene || !field(scene, system) || !record) return 0;
      const activity = Math.max(scene.activity(system), 1e-6),
        current =
          record.strength ?? clamp(Math.ceil(placed.parameters.intensity / activity), 50, 1000),
        raised = clamp(Math.ceil(current + needed / activity), current, 1000);
      // The source rides the crust with its landmark; its record follows the drifted anchor.
      upsertSource(map, placed, scene, system, raised, epoch);
      record.strength = raised;
      if (raised >= 1000 && needed > 0)
        note(
          record,
          `${system}'s activity caps the source at full strength; the intensity falls ${needed.toFixed(0)} short.`
        );
      return 0;
    },
  };
}
/** The magic kinds of the catalogue, keyed by id. */
export const magicLandmarkKinds: Record<string, Kind> = Object.fromEntries(
  catalogue.filter((kind) => kind.system).map((kind) => [kind.id, magicKind(kind.id, kind.system!)])
);
