import { expect, it, vi } from "vitest";
import { rectangle } from "@atlas/domain";
import { fixture, scope, record, write, query } from "./catalogFixture";

const course = record("course", {
  type: "LineString",
  coordinates: [
    [0, 500],
    [1000, 500],
  ],
});
function follower() {
  const value = record("follower", {
    type: "LineString",
    coordinates: [
      [10, 10],
      [20, 20],
    ],
  });
  if (value.data.kind === "feature")
    value.data.value.relations = [{ kind: "follows", targetId: "course" }];
  return value;
}
it("composes a feature once and again only after one of its input records changes", async () => {
  const catalog = await fixture();
  await write(catalog, [course, follower()]);
  const overlay = vi.spyOn(catalog.kernel, "overlay");
  const first = await catalog.readFeature(scope, "follower");
  expect(first.geometry).toMatchObject({ type: "LineString" });
  expect(overlay).toHaveBeenCalled();
  overlay.mockClear();
  expect(await catalog.readFeature(scope, "follower")).toEqual(first);
  await write(catalog, [record("unrelated")]);
  expect(await catalog.readFeature(scope, "follower")).toEqual(first);
  expect(overlay).not.toHaveBeenCalled();
  const moved = (await catalog.readRecords(scope, "feature", ["course"]))[0];
  if (moved.data.kind !== "feature") throw new Error("Missing course.");
  moved.data.value.geometry = {
    type: "LineString",
    coordinates: [
      [0, 600],
      [1000, 600],
    ],
  };
  await write(catalog, [moved]);
  expect((await catalog.readFeature(scope, "follower")).geometry).toMatchObject({
    coordinates: [
      [0, 600],
      [1000, 600],
    ],
  });
  expect(overlay).toHaveBeenCalled();
});
it("finds followers through their targets' stored reach, and refreshes it after edits", async () => {
  const catalog = await fixture();
  await write(catalog, [course, follower(), record("wood", rectangle([700, 700, 800, 800]))]);
  const ids = async (extent: [number, number, number, number]) =>
    (await catalog.readFeatures(query({ extent }))).records.map((r) => r.feature.id);
  expect(await ids([490, 490, 510, 510])).toEqual(["course", "follower"]);
  const moved = (await catalog.readRecords(scope, "feature", ["course"]))[0];
  if (moved.data.kind !== "feature") throw new Error("Missing course.");
  moved.data.value.geometry = {
    type: "LineString",
    coordinates: [
      [0, 750],
      [1000, 750],
    ],
  };
  await write(catalog, [moved]);
  expect(await ids([490, 490, 510, 510])).toEqual([]);
  expect(await ids([490, 740, 510, 760])).toEqual(["course", "follower"]);
  expect(await ids([710, 710, 720, 720])).toEqual(["wood"]);
  expect(
    (await catalog.readFeatures(query({ extent: [0, 0, 1000, 1000], dimension: "polygon" })))
      .records.map((r) => r.feature.id)
  ).toEqual(["wood"]);
});
