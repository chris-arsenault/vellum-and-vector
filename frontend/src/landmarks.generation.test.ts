import { expect, it } from "vitest";
import { generateAtlas, prepareAtlasGeneration } from "@atlas/generation";
import { gridPosition, type DrainageNetwork, type Grid, type World } from "@atlas/domain";
import { sequenceStages } from "../../packages/generation/src/sequence";
import {
  signatureShortfall,
  type LandmarkRecord,
} from "../../packages/generation/src/canonry/landmarks";
import { createWorld, session } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { makeCommand } from "./useAtlas";

const km = 1000;
type Site = { x: number; y: number };

/** Grid cells on land, farthest from the sea first, in world coordinates. */
function interiorSites(grid: Grid) {
  const elevation = grid.channels.elevation,
    sea: number[] = [],
    land: number[] = [];
  for (let i = 0; i < elevation.length; i++) (elevation[i] > 0 ? land : sea).push(i);
  const at = (i: number) => gridPosition(grid, i);
  const clearance = (i: number) => {
    const p = at(i);
    return sea.reduce((best, j) => {
      const q = at(j);
      return Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    }, Infinity);
  };
  return land
    .map((i) => ({ ...at(i), clearance: clearance(i) }))
    .sort((a, b) => b.clearance - a.clearance);
}
function gridIndexAt(grid: Grid, x: number, y: number) {
  const width = grid.width!,
    height = grid.height!;
  return (
    Math.round(((y - grid.bounds[1]) / (grid.bounds[3] - grid.bounds[1])) * (height - 1)) * width +
    Math.round(((x - grid.bounds[0]) / (grid.bounds[2] - grid.bounds[0])) * (width - 1))
  );
}
function landmarkProcesses(prepared: ReturnType<typeof prepareAtlasGeneration>) {
  return sequenceStages(prepared.input.configuration!.sequence)
    .map((stage) => stage.invocation?.process ?? "")
    .filter((process) => process.startsWith("landmark."));
}
/** A mountain on the most interior land and a canyon 150 km long pointing toward it. */
function placeLandmarks(world: World, areaId: string, sites: Site[]) {
  const mountainAt = sites[0],
    canyonFrom = sites.find((s) => Math.hypot(s.x - mountainAt.x, s.y - mountainAt.y) > 350 * km)!;
  const heading = Math.atan2(mountainAt.y - canyonFrom.y, mountainAt.x - canyonFrom.x);
  const canyonTo = {
    x: canyonFrom.x + Math.cos(heading) * 150 * km,
    y: canyonFrom.y + Math.sin(heading) * 150 * km,
  };
  const mountainId = crypto.randomUUID(),
    canyonId = crypto.randomUUID();
  const current = commitCommand(
    world.id,
    makeCommand(session(world.id).snapshot.world, "putLandmark", {
      areaId,
      id: mountainId,
      name: "Kibo",
      kind: "volcanic-mountain",
      geometry: { type: "Point", coordinates: [mountainAt.x, mountainAt.y] },
      parameters: { summit: 4500, prominence: 3000, baseRadius: 60 },
      emplacedAtEpoch: 0,
    })
  ).candidate;
  commitCommand(
    world.id,
    makeCommand(current, "putLandmark", {
      areaId,
      id: canyonId,
      name: "Long Cut",
      kind: "canyon",
      geometry: {
        type: "LineString",
        coordinates: [
          [canyonFrom.x, canyonFrom.y],
          [(canyonFrom.x + canyonTo.x) / 2, (canyonFrom.y + canyonTo.y) / 2],
          [canyonTo.x, canyonTo.y],
        ],
      },
      parameters: { depth: 900, rimWidth: 20, captureDistance: 150 },
      emplacedAtEpoch: 0,
    })
  );
  return { mountainId, canyonId, mountainAt };
}
/**
 * A falls on the largest published river that keeps clear of the other landmarks, on a reach
 * high enough above the sea for a 50 m step to be cut rather than lifted.
 */
function placeFalls(
  world: World,
  areaId: string,
  drainage: DrainageNetwork,
  clear: Site[],
  grid: Grid
) {
  // Reaches run into the mesh padding; the falls needs a coordinate inside the world.
  const inside = (c: [number, number]) =>
    c[0] > 40 * km && c[0] < 1960 * km && c[1] > 40 * km && c[1] < 960 * km;
  const high = (c: [number, number]) =>
    grid.channels.elevation[gridIndexAt(grid, c[0], c[1])] >= 150;
  const far = (c: [number, number]) =>
    clear.every((s) => Math.hypot(c[0] - s.x, c[1] - s.y) > 200 * km);
  const usable = (c: [number, number]) => inside(c) && high(c);
  const reach = [...drainage.reaches]
    .filter((r) => r.coordinates.filter(usable).length >= 3 && r.coordinates.every(far))
    .sort((a, b) => Math.max(...b.discharges) - Math.max(...a.discharges))[0];
  expect(reach, "a published river away from the other landmarks").toBeDefined();
  const candidates = reach.coordinates.filter(usable),
    at = candidates[Math.floor(candidates.length / 2)];
  const id = crypto.randomUUID();
  commitCommand(
    world.id,
    makeCommand(session(world.id).snapshot.world, "putLandmark", {
      areaId,
      id,
      name: "Thunder Falls",
      kind: "falls",
      geometry: { type: "Point", coordinates: [at[0], at[1]] },
      parameters: { drop: 50, discharge: 2400, captureDistance: 100 },
      emplacedAtEpoch: 0,
    })
  );
  return { fallsId: id, fallsAt: { x: at[0], y: at[1] } };
}
function expectHeld(epochs: Record<string, LandmarkRecord>[], ids: string[], count: number) {
  expect(epochs).toHaveLength(count);
  for (const [index, records] of epochs.entries())
    for (const id of ids) {
      const record = records[id];
      expect(record, `${id} recorded in epoch ${index}`).toBeDefined();
      expect(record.realized).toBe(record.kind !== "falls");
      expect(
        signatureShortfall(record, record.measured),
        `epoch ${index} ${record.kind} ${JSON.stringify(record.measured)}`
      ).toEqual({});
    }
}
/** The published river at the falls shows the drop within one cell of the point. */
function expectStep(world: World, fallsId: string, fallsAt: Site, spacing: number) {
  const feature = world.features[fallsId];
  expect(feature).toMatchObject({
    kind: "landmark",
    name: "Thunder Falls",
    attributes: { signature: "latent", dropTarget: 50 },
  });
  expect(Number(feature.attributes.drop)).toBeGreaterThanOrEqual(50);
  const rivers = Object.values(world.features).filter(
    (f) => f.kind === "river" && f.geometry.type === "LineString"
  );
  const stations = rivers.flatMap((river) => {
    const elevations = river.attributes.elevations as number[];
    return (river.geometry as { coordinates: number[][] }).coordinates.map((c, k) => ({
      d: Math.hypot(c[0] - fallsAt.x, c[1] - fallsAt.y),
      z: elevations[k],
      river: river.id,
    }));
  });
  const near = stations.filter((s) => s.d <= spacing * 1.5).map((s) => s.z);
  expect(near.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...near) - Math.min(...near)).toBeGreaterThanOrEqual(40);
}

/**
 * Each landmark publishes once, under its own identity, with its signature; no detected peak
 * doubles the mountain, and no crater or volcano is made of a landmark's event.
 */
function expectPublished(world: World, mountainId: string, canyonId: string, mountainAt: Site) {
  const features = Object.values(world.features);
  const kibo = world.features[mountainId],
    cut = world.features[canyonId];
  expect(kibo).toMatchObject({
    kind: "landmark",
    layerId: "geology",
    name: "Kibo",
    attributes: { landmarkKind: "volcanic-mountain", signature: "realized", summitTarget: 4500 },
  });
  expect(Number(kibo.attributes.summit)).toBeGreaterThanOrEqual(4500);
  expect(cut).toMatchObject({
    kind: "landmark",
    name: "Long Cut",
    attributes: { depthTarget: 900 },
  });
  expect(Number(cut.attributes.depth)).toBeGreaterThanOrEqual(900);
  expect(Number(cut.attributes.maintenance)).toBeGreaterThanOrEqual(0);
  const peaks = features.filter((f) => {
    if (f.kind !== "peak" || f.geometry.type !== "Point") return false;
    const [x, y] = f.geometry.coordinates;
    return Math.hypot(x - mountainAt.x, y - mountainAt.y) < 30 * km;
  });
  expect(peaks).toEqual([]);
  expect(features.filter((f) => f.kind === "landmark")).toHaveLength(3);
  expect(
    features.some(
      (f) => f.kind !== "landmark" && String(f.attributes.causeId ?? "").startsWith("landmark:")
    )
  ).toBe(false);
}

it("forms and holds a mountain and a canyon through a Draft world's physical history", async () => {
  const world = createWorld({
    name: "Landmark world",
    seed: 104729,
    width: 2000 * km,
    height: 1000 * km,
  });
  const areaId = Object.keys(world.areas)[0];
  const input = { areaId, domains: ["physical"], quality: "draft", seed: world.seed };
  // Nothing runs for landmarks until one is placed.
  expect(landmarkProcesses(prepareAtlasGeneration(session(world.id).snapshot, input))).toEqual([]);
  const first = await generateAtlas(session(world.id).snapshot, input);
  const { mountainId, canyonId, mountainAt } = placeLandmarks(
    world,
    areaId,
    interiorSites(first.state.surface)
  );
  const canyon = session(world.id).snapshot.world.landmarks.find((l) => l.kind === "canyon")!;
  const { fallsId, fallsAt } = placeFalls(
    world,
    areaId,
    first.state.domain.world.drainage![areaId],
    [
      mountainAt,
      ...(canyon.geometry as { coordinates: number[][] }).coordinates.map(([x, y]) => ({ x, y })),
    ],
    first.state.surface
  );
  const placed = landmarkProcesses(prepareAtlasGeneration(session(world.id).snapshot, input));
  expect(placed).toEqual(expect.arrayContaining(["landmark.emplace", "landmark.maintain"]));
  expect(placed.filter((p) => p === "landmark.maintain")).toHaveLength(world.epochs.length);
  expect(
    landmarkProcesses(
      prepareAtlasGeneration(session(world.id).snapshot, {
        ...input,
        features: { "physical.landmarks": { enabled: false } },
      })
    )
  ).toEqual([]);

  const epochs: Record<string, LandmarkRecord>[] = [];
  const result = await generateAtlas(session(world.id).snapshot, input, {
    async saveBoundary(boundary) {
      if (boundary.kind !== "epoch") return;
      epochs.push(
        structuredClone(Object.fromEntries(boundary.state.physical?.landmarks ?? new Map()))
      );
    },
  });
  expectHeld(epochs, [mountainId, canyonId, fallsId], world.epochs.length);
  const grid = result.state.surface;
  expectStep(
    result.state.domain.world,
    fallsId,
    fallsAt,
    Math.hypot(grid.bounds[2] - grid.bounds[0], 0) / (grid.width! - 1)
  );
  expect(grid.channels.elevation[gridIndexAt(grid, mountainAt.x, mountainAt.y)]).toBeGreaterThan(
    4500 * 0.8
  );
  expect(grid.channels.landmarkMaintenance.some((value) => value > 0)).toBe(true);
  const causes = result.state.history.flatMap((entry) => entry.causes);
  expect(causes.some((c) => c.kind === "domain" && c.description.startsWith("Kibo formed"))).toBe(
    true
  );
  expect(
    causes.filter((c) => c.kind === "domain" && c.description.startsWith("Long Cut held"))
  ).toHaveLength(world.epochs.length);
  expectPublished(result.state.domain.world, mountainId, canyonId, mountainAt);
  // Another seed regenerates the same identities with the same names.
  const other = await generateAtlas(session(world.id).snapshot, { ...input, seed: 7 });
  expect(other.state.domain.world.features[mountainId]?.name).toBe("Kibo");
  expect(other.state.domain.world.features[canyonId]?.name).toBe("Long Cut");
}, 600_000);
