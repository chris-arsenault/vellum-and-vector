import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { latitudeAt, latitudeAtY } from "./latitude";
import { atlasParametersSchema } from "../atlasParameters";

it("maps world northing to latitude identically for a world and a nested region", () => {
  const profile = atlasPhysicalProfile({ southLatitude: -20, northLatitude: 60 });
  profile.WorldExtentY = [0, 3_000_000];
  const world = createField(createWorldMesh([0, 0, 4_000_000, 3_000_000], 4096, 100_000));
  const region = createField(
    createWorldMesh([1_000_000, 1_200_000, 1_400_000, 1_600_000], 1024, 20_000)
  );
  expect(latitudeAtY(profile, 0)).toBe(-20);
  expect(latitudeAtY(profile, 3_000_000)).toBe(60);
  expect(latitudeAtY(profile, 750_000)).toBe(0);
  for (const map of [world, region])
    for (let i = 0; i < map.mesh.contentCount; i += 37) {
      const y = map.mesh.y[i] + map.mesh.origin[1];
      expect(latitudeAt(profile, map, i)).toBeCloseTo(-20 + (80 * y) / 3_000_000, 9);
    }
});

it("places a map without a world frame at its mid latitude", () => {
  const profile = atlasPhysicalProfile({ southLatitude: 20, northLatitude: 60 });
  const map = createField(createWorldMesh([0, 0, 400_000, 400_000], 256, 10_000));
  for (let i = 0; i < map.mesh.count; i += 11) expect(latitudeAt(profile, map, i)).toBe(40);
});

it("rejects a north edge south of the south edge", () => {
  expect(() => atlasParametersSchema.parse({ southLatitude: 40, northLatitude: 10 })).toThrow();
  expect(atlasParametersSchema.parse({})).toMatchObject({ southLatitude: 10, northLatitude: 70 });
});
