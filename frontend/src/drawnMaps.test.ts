import { it, expect } from "vitest";
import {
  defaultCartographicPresentation,
  cartographicPresentationSchema,
  rectangle,
} from "@atlas/domain";
import { createWorld, session, undoWorld } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { cartographicFeatureStyle, polityIdentity } from "./drawnStyles";
import { atlasColour } from "./drawnSymbols";
import type { AtlasFeature } from "./types";

function fixture() {
  const world = createWorld({ name: "Drawn atlas", seed: 3, width: 100000, height: 100000 });
  const areaId = Object.keys(world.areas)[0];
  const command = (data: Record<string, unknown>) =>
    commitCommand(world.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: session(world.id).snapshot.world.version,
      kind: "putView",
      data,
    });
  return { world, areaId, command };
}
it("retains independent compositions of a region through commands and undo without modifying geography", () => {
  const f = fixture(),
    regionId = crypto.randomUUID();
  f.command({
    id: regionId,
    areaId: f.areaId,
    name: "Coast",
    layers: [],
    region: { parentId: null, footprint: rectangle([0, 0, 50000, 50000]) },
  });
  const before = structuredClone(session(f.world.id).snapshot);
  const cartography = { ...defaultCartographicPresentation(), mode: "drawn" as const };
  for (const name of ["Politics", "Languages"])
    f.command({
      id: crypto.randomUUID(),
      areaId: f.areaId,
      name,
      layers: [],
      regionId,
      cartography,
    });
  const after = session(f.world.id).snapshot;
  expect(after.world.views.filter((v) => v.regionId === regionId)).toHaveLength(2);
  expect(after.world.areas).toEqual(before.world.areas);
  expect(after.world.features).toEqual(before.world.features);
  expect(after.numerical).toEqual(before.numerical);
  const view = after.world.views[1];
  f.command({
    ...view,
    cartography: {
      ...cartography,
      overrides: {
        river: {
          offsetX: 20,
          path: [
            [0, 0],
            [20, 30],
          ],
        },
      },
    },
  });
  expect(
    session(f.world.id).snapshot.world.views[1].cartography?.overrides.river.path
  ).toHaveLength(2);
  undoWorld(f.world.id, session(f.world.id).history[0].operationId);
  expect(session(f.world.id).snapshot.world.views[1].cartography?.overrides).toEqual({});
});
it("rejects malformed presentation and label coordinates", () => {
  const base = defaultCartographicPresentation();
  expect(cartographicPresentationSchema.safeParse({ ...base, density: Infinity }).success).toBe(
    false
  );
  expect(
    cartographicPresentationSchema.safeParse({ ...base, overrides: { x: { anchor: [NaN, 0] } } })
      .success
  ).toBe(false);
  expect(
    cartographicPresentationSchema.safeParse({ ...base, overrides: { x: { path: [[0, 0]] } } })
      .success
  ).toBe(false);
});
it("keeps political identity across territory kinds without filling claims as sovereignty", () => {
  const f = fixture();
  const territory = {
    id: "territory",
    kind: "sovereignty",
    layerId: "sovereignty",
    name: "Country",
    geometry: rectangle([0, 0, 50000, 50000]),
    attributes: {},
    relations: [{ kind: "sovereign", targetId: "polity" }],
  } as AtlasFeature;
  const claim = {
    ...territory,
    id: "claim",
    kind: "claim",
    layerId: "claims",
    relations: [{ kind: "claimedBy", targetId: "polity" }],
  };
  const layer = {
    layerId: "sovereignty",
    visible: true,
    color: "#000000",
    opacity: 1,
    minScale: 0,
    labels: false,
  };
  const context = {
    world: f.world,
    view: { ...defaultCartographicPresentation(), mode: "drawn" as const },
  };
  expect(polityIdentity(territory)).toBe(polityIdentity(claim));
  expect(atlasColour(polityIdentity(territory))).toBe(atlasColour(polityIdentity(claim)));
  expect(
    cartographicFeatureStyle(territory, layer, 100, context)[0].getStroke()?.getLineDash()
  ).toBeNull();
  expect(cartographicFeatureStyle(claim, layer, 100, context)[0].getFill()?.getColor()).toBe(
    "#00000000"
  );
});
