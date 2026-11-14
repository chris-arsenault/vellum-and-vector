import { expect, it } from "vitest";
import { rectangle, type CatalogRecord } from "@atlas/domain";
import { fixture, scope, record, write } from "./catalogFixture";
import { analysisRequirements } from "../../../frontend/src/analysisRequirements";
import { analyzeSnapshot, type AnalysisInput } from "../../../frontend/src/spatialAnalysis";

const input: AnalysisInput = {
  areaId: scope.areaId,
  operation: "measure",
  geometry: rectangle([0, 0, 1, 1]),
  featureId: null,
  targetFeatureId: null,
  layer: null,
  channel: null,
  distance: 10,
  networkKind: "road",
};
it("measures without geometry reads and finds connected rooms beyond the selected extent", async () => {
  const catalog = await fixture();
  const rooms = ["a", "b", "c", "unrelated"].map((id, i) => {
    const room = record(id, rectangle([100 * i, 100, 100 * i + 10, 110]));
    if (room.data.kind === "feature" && i < 2)
      room.data.value.relations = [{ kind: "connects", targetId: i === 0 ? "b" : "c" }];
    return room;
  });
  await write(catalog, rooms);
  const world = await catalog.readEditor(scope.worldId);
  const measured = await catalog.readAuthoring(analysisRequirements(world, input));
  expect(Object.keys(measured.world.features)).toEqual([]);
  expect(analyzeSnapshot(measured, input).measurements.area_m2).toBe(1);
  const request = { ...input, operation: "circulation", featureId: "a", targetFeatureId: "c" };
  const connected = await catalog.readAuthoring(analysisRequirements(world, request));
  expect(Object.keys(connected.world.features).sort()).toEqual(["a", "b", "c"]);
  expect(analyzeSnapshot(connected, request).path).toEqual(["a", "b", "c"]);
});
it("resolves a route across intermediate network reaches without loading disconnected geography", async () => {
  const catalog = await fixture(),
    writes: CatalogRecord[] = [];
  for (let i = 0; i < 4; i++) {
    const feature = record(`road-${i}`, {
      type: "LineString",
      coordinates: [
        [i * 100, 50],
        [(i + 1) * 100, 50],
      ],
    });
    if (feature.data.kind !== "feature") throw new Error("Missing road.");
    feature.data.value.kind = "road";
    writes.push(feature, {
      scope,
      reference: { kind: "reach", id: `reach-${i}`, revision: 0 },
      data: {
        kind: "reach",
        value: {
          id: `reach-${i}`,
          featureId: feature.reference.id,
          start: `node-${i}`,
          end: `node-${i + 1}`,
          geometry: feature.data.value.geometry as import("geojson").LineString,
          flow: 0,
          endFlow: null,
        },
      },
    });
  }
  for (let i = 0; i < 5; i++)
    writes.push({
      scope,
      reference: { kind: "node", id: `node-${i}`, revision: 0 },
      data: {
        kind: "node",
        value: {
          id: `node-${i}`,
          kind: "road",
          position: { x: i * 100, y: 50, z: 0 },
          spaceId: scope.spaceId,
          waterLevel: null,
        },
      },
    });
  await write(catalog, [...writes, record("unrelated")]);
  const request = {
    ...input,
    operation: "networkPath",
    featureId: "road-0",
    targetFeatureId: "road-3",
  };
  const source = await catalog.readAuthoring(
    analysisRequirements(await catalog.readEditor(scope.worldId), request)
  );
  expect(source.world.features).not.toHaveProperty("unrelated");
  expect(analyzeSnapshot(source, request).path).toEqual(["road-0", "road-1", "road-2", "road-3"]);
});
