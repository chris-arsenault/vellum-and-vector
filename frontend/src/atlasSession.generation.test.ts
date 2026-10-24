import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { createWorld, session } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { makeCommand } from "./useAtlas";

it("runs a causal landscape without services and retains authored features", async () => {
  const initial = createWorld({ name: "Atlas", seed: 104729, width: 4_000_000, height: 2_000_000 });
  const areaId = Object.keys(initial.areas)[0];
  const markerId = crypto.randomUUID();
  commitCommand(
    initial.id,
    makeCommand(initial, "putFeature", {
      areaId,
      feature: {
        id: markerId,
        name: "Authored landmark",
        kind: "poi",
        layerId: "pois",
        geometry: { type: "Point", coordinates: [50000, 50000] },
        attributes: {},
        relations: [],
        protected: true,
      },
    })
  );
  const result = await generateAtlas(session(initial.id).snapshot, {
    areaId,
    domains: ["physical", "cultural", "political", "built"],
    quality: "draft",
    seed: initial.seed,
  });
  expect(result.state.history.flatMap((h) => h.ancestry.map((epoch) => epoch.id))).toEqual(
    expect.arrayContaining(initial.epochs.map((epoch) => epoch.id))
  );
  expect(result.state.surface.channels.flow.some((v) => v > 0)).toBe(true);
  expect(result.state.surface.channels.elevation.every(Number.isFinite)).toBe(true);
  expect(result.state.domain.world.features[markerId].name).toBe("Authored landmark");
  expect(
    Object.values(result.state.domain.world.features).some((f) => f.kind === "sovereignty")
  ).toBe(true);
  const cultures = Object.values(result.state.domain.world.entities).filter(
    (entity) => entity.kind === "culture"
  );
  expect(cultures.length).toBeGreaterThan(0);
  expect(
    Object.keys(result.state.surface.channels)
      .filter((c) => c.startsWith("culture:"))
      .sort()
  ).toEqual(cultures.map((culture) => `culture:${culture.id}`).sort());
}, 120000);
