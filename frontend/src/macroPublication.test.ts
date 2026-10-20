import { expect, it } from "vitest";
import { createGrid, putChannel, fieldInterpolator, gridSchema } from "@atlas/domain";
import { createWorld, session } from "./atlasState";
import { generationSnapshot } from "./generationJobs";
import { initialState } from "../../packages/generation/src/atlasWorkflow";

function publicationFixture() {
  const world = createWorld({
      name: "Composed publication",
      seed: 42,
      width: 10_000,
      height: 10_000,
    }),
    domain = session(world.id).snapshot,
    grid = createGrid("composed", domain.scope, 5, 5);
  for (const [name, value, unit] of [
    ["elevation", 100, "metre"],
    ["bedrock", 90, "metre"],
    ["slope", 0, "gradient"],
    ["fracture", 0.2, "ratio"],
    ["treeCover", 0.6, "ratio"],
    ["water", 0, "category"],
    ["waterDepth", 0, "metre"],
    ["seaLevel", 0, "metre"],
  ] as const)
    putChannel(grid, name, unit, new Float64Array(25).fill(value));
  const finished = createGrid("finished", domain.scope, 9, 9);
  for (const [name, value, unit] of [
    ["elevation", -100, "metre"],
    ["bedrock", -110, "metre"],
    ["fracture", 0.8, "ratio"],
    ["water", 1, "category"],
    ["waterDepth", 100, "metre"],
    ["seaLevel", 0, "metre"],
  ] as const)
    putChannel(finished, name, unit, new Float64Array(81).fill(value));
  finished.ocean = finished.scope.footprint;
  const surface = {
    ...grid,
    overlays: [{ grid: finished, channels: Object.keys(finished.channels) }],
  };
  return { domain, surface };
}
it("retains composed elevation and bedrock when publication splits geology and water into separate resources", () => {
  const { domain, surface } = publicationFixture();
  const result = generationSnapshot(
      {
        kind: "final",
        configurationHash: "fixture",
        ancestry: [],
        state: { domain, surface, facts: new Set(), history: [] },
      },
      { areaId: domain.scope.areaId, seed: 42, quality: "draft", domains: ["physical"] },
      crypto.randomUUID()
    ),
    resource = (layer: string, channel?: string) =>
      result.numerical[
        result.world.fields.find(
          (f) => f.layerId === layer && (!channel || f.channels?.includes(channel))
        )!.id
      ],
    geology = resource("geology", "bedrock"),
    water = resource("rivers"),
    elevation = resource("elevation"),
    p = { x: 5000, y: 5000, z: 0 };
  expect(geology.channels.elevation).toBeUndefined();
  expect(water.channels.elevation).toBeUndefined();
  expect(fieldInterpolator(elevation, "elevation")(p)).toBe(-100);
  expect(fieldInterpolator(geology, "bedrock")(p)).toBe(-110);
  expect(fieldInterpolator(water, "water")(p)).toBe(1);
  expect(fieldInterpolator(water, "waterDepth")(p)).toBe(100);
  const clone = structuredClone(geology);
  delete clone.overlays;
  expect(gridSchema.safeParse(clone).success).toBe(true);
  const inherited = initialState(result, {
    areaId: domain.scope.areaId,
    seed: 42,
    quality: "draft",
    domains: ["magic"],
  });
  expect(fieldInterpolator(inherited.surface, "elevation")(p)).toBe(-100);
  expect(inherited.surface.overlays!.some((part) => part.grid === elevation)).toBe(true);
  const shoulder = { x: 7000, y: 5000, z: 0 };
  expect(fieldInterpolator(inherited.surface, "fracture")(shoulder)).toBeCloseTo(
    fieldInterpolator(geology, "fracture")(shoulder),
    9
  );
  expect(resource("ecology").active.length).toBe(25);
  expect(elevation.active.length).toBe(81);
  expect("landscape" in elevation).toBe(false);
  expect("landscapeBase" in geology).toBe(false);
});
