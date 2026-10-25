import { expect, it } from "vitest";
import { createWorld, session, undoWorld } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { readScene } from "./atlasReads";
import { makeCommand } from "./useAtlas";
import {
  DomainError,
  canonicalFeatures,
  describeFeature,
  landmarkKind,
  type World,
} from "@atlas/domain";

const km = 1000;
function world() {
  const created = createWorld({ name: "Landmarks", seed: 11, width: 2000 * km, height: 1000 * km });
  return { world: created, areaId: Object.keys(created.areas)[0] };
}
function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error instanceof DomainError ? error.code : String(error);
  }
  return null;
}
const mountain = (areaId: string, id: string, overrides: Record<string, unknown> = {}) => ({
  areaId,
  id,
  name: "Kibo",
  kind: "volcanic-mountain",
  geometry: { type: "Point", coordinates: [800 * km, 500 * km] },
  parameters: { summit: 5900, prominence: 4000, baseRadius: 30 },
  emplacedAtEpoch: 0,
  ...overrides,
});

it("authors, edits, lists, removes and undoes landmarks through the session", () => {
  const { world: initial, areaId } = world();
  const mountainId = crypto.randomUUID(),
    canyonId = crypto.randomUUID();
  let current: World = commitCommand(
    initial.id,
    makeCommand(initial, "putLandmark", mountain(areaId, mountainId))
  ).candidate;
  current = commitCommand(
    current.id,
    makeCommand(current, "putLandmark", {
      areaId,
      id: canyonId,
      name: "Long Cut",
      kind: "canyon",
      geometry: {
        type: "LineString",
        coordinates: [
          [200 * km, 300 * km],
          [500 * km, 320 * km],
          [700 * km, 400 * km],
        ],
      },
      parameters: { depth: 1500, rimWidth: 15, captureDistance: 150 },
      emplacedAtEpoch: 1,
    })
  ).candidate;
  expect(current.landmarks.map((l) => [l.name, l.kind, l.emplacedAtEpoch, l.areaId])).toEqual([
    ["Kibo", "volcanic-mountain", 0, areaId],
    ["Long Cut", "canyon", 1, areaId],
  ]);
  const scene = readScene(current.id, areaId);
  const kibo = scene.find((f) => f.id === mountainId)!;
  expect(kibo).toMatchObject({
    kind: "landmark",
    layerId: "geology",
    state: "authored",
    protected: true,
    attributes: { landmarkKind: "volcanic-mountain", summit: 5900, emplacedAtEpoch: 0 },
  });
  expect(kibo.footprint?.type).toBe("Polygon");
  expect(describeFeature(current, kibo).path).toEqual([
    "Terrain and geology",
    "Landmarks",
    "Landmark",
    "Volcanic mountain",
  ]);
  expect(scene.find((f) => f.id === canyonId)!.geometry.type).toBe("LineString");

  const moved = commitCommand(
    current.id,
    makeCommand(
      current,
      "putLandmark",
      mountain(areaId, mountainId, {
        name: "Kibo Peak",
        geometry: { type: "Point", coordinates: [900 * km, 450 * km] },
      })
    )
  ).candidate;
  expect(moved.landmarks).toHaveLength(2);
  expect(moved.landmarks.find((l) => l.id === mountainId)).toMatchObject({
    name: "Kibo Peak",
    geometry: { coordinates: [900 * km, 450 * km] },
  });

  const removed = commitCommand(
    moved.id,
    makeCommand(moved, "removeLandmark", { areaId, id: canyonId })
  ).candidate;
  expect(removed.landmarks.map((l) => l.id)).toEqual([mountainId]);
  const restored = undoWorld(removed.id, session(removed.id).history[0].operationId);
  expect(restored.landmarks.map((l) => l.id).sort()).toEqual([mountainId, canyonId].sort());
});

it("rejects unknown kinds, mismatched geometry, out-of-range or undeclared measures, bad epochs and outside placement", () => {
  const { world: current, areaId } = world();
  const id = crypto.randomUUID();
  const attempt = (overrides: Record<string, unknown>) =>
    failure(() =>
      commitCommand(
        current.id,
        makeCommand(current, "putLandmark", mountain(areaId, id, overrides))
      )
    );
  expect(attempt({ kind: "great-pyramid" })).toBe("landmark_kind");
  expect(
    attempt({
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [10 * km, 0],
        ],
      },
    })
  ).toBe("landmark_geometry");
  expect(attempt({ parameters: { summit: 12000, prominence: 4000, baseRadius: 30 } })).toBe(
    "landmark_parameter"
  );
  expect(attempt({ parameters: { summit: 5900, baseRadius: 30 } })).toBe("landmark_parameter");
  expect(
    attempt({ parameters: { summit: 5900, prominence: 4000, baseRadius: 30, moons: 2 } })
  ).toBe("landmark_parameter");
  expect(attempt({ emplacedAtEpoch: current.epochs.length })).toBe("landmark_epoch");
  expect(attempt({ geometry: { type: "Point", coordinates: [-5 * km, 500 * km] } })).toBe(
    "landmark_location"
  );
  expect(
    failure(() => commitCommand(current.id, makeCommand(current, "removeLandmark", { areaId, id })))
  ).toBe("missing_landmark");
  expect(session(current.id).snapshot.world.version).toBe(1);
  const message = (() => {
    try {
      commitCommand(
        current.id,
        makeCommand(
          current,
          "putLandmark",
          mountain(areaId, id, { parameters: { summit: 5900, prominence: 50, baseRadius: 30 } })
        )
      );
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  })();
  expect(message).toBe("Prominence must be between 300 and 9000 m.");
});

it("reads one row per landmark: the realization under the authored name, else the record", () => {
  const { world: initial, areaId } = world();
  const id = crypto.randomUUID();
  const current = commitCommand(
    initial.id,
    makeCommand(initial, "putLandmark", mountain(areaId, id, { name: "Kibo" }))
  ).candidate;
  const before = canonicalFeatures(current).filter((f) => f.id === id);
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({ state: "authored", attributes: { signature: "authored" } });
  const realized = structuredClone(current);
  realized.features[id] = {
    ...before[0],
    name: "Stale generated name",
    state: "generated",
    protected: false,
    actor: "generator",
    attributes: { summit: 4510, summitTarget: 5900, signature: "realized", maintenance: 12 },
  };
  const rows = canonicalFeatures(realized).filter((f) => f.id === id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    name: "Kibo",
    state: "generated",
    attributes: { summit: 4510, signature: "realized", landmarkKind: "volcanic-mountain" },
  });
  expect(describeFeature(realized, rows[0]).path).toEqual([
    "Terrain and geology",
    "Landmarks",
    "Landmark",
    "Volcanic mountain",
  ]);
});

it("declares every catalogue kind with in-range defaults and a positive reach", () => {
  for (const kind of [
    "volcanic-mountain",
    "canyon",
    "dome-ring",
    "impact-ring",
    "escarpment",
    "falls",
  ]) {
    const declared = landmarkKind(kind)!;
    const defaults = Object.fromEntries(declared.parameters.map((p) => [p.key, p.default]));
    for (const parameter of declared.parameters) {
      expect(parameter.default).toBeGreaterThanOrEqual(parameter.min);
      expect(parameter.default).toBeLessThanOrEqual(parameter.max);
    }
    expect(declared.reach(defaults)).toBeGreaterThan(0);
  }
});
