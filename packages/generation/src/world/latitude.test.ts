import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { latitudeAt, latitudeAtY, northingAtLatitude } from "./latitude";
import { atlasParametersSchema } from "../atlasParameters";

it("maps world northing linearly under the even-degree projection, for a world and a region", () => {
  const profile = atlasPhysicalProfile({
    southLatitude: -20,
    northLatitude: 60,
    latitudeProjection: 0,
  });
  profile.WorldExtentY = [0, 3_000_000];
  const world = createField(createWorldMesh([0, 0, 4_000_000, 3_000_000], 4096, 100_000));
  const region = createField(
    createWorldMesh([1_000_000, 1_200_000, 1_400_000, 1_600_000], 1024, 20_000)
  );
  expect(latitudeAtY(profile, 0)).toBe(-20);
  expect(latitudeAtY(profile, 3_000_000)).toBe(60);
  expect(latitudeAtY(profile, 750_000)).toBe(0);
  for (const map of [world, region])
    for (let i = 0; i < map.mesh.count; i += 37) {
      if (map.mesh.membership(i) !== 1) continue;
      const y = map.mesh.y(i) + map.mesh.origin[1];
      expect(latitudeAt(profile, map, i)).toBeCloseTo(-20 + (80 * y) / 3_000_000, 9);
    }
});

it("spaces latitudes by equal area, independent of the world's size", () => {
  for (const height of [1_000_000, 3_000_000, 12_000_000]) {
    const globe = atlasPhysicalProfile({ southLatitude: -90, northLatitude: 90 });
    globe.WorldExtentY = [0, height];
    expect(latitudeAtY(globe, 0)).toBeCloseTo(-90, 9);
    expect(latitudeAtY(globe, height / 2)).toBeCloseTo(0, 9);
    expect(latitudeAtY(globe, height)).toBeCloseTo(90, 9);
    // Half of a hemisphere's area lies below 30°, so 30° sits at three quarters.
    expect(latitudeAtY(globe, (height * 3) / 4)).toBeCloseTo(30, 9);
  }
  const band = atlasPhysicalProfile({ southLatitude: 10, northLatitude: 70 });
  band.WorldExtentY = [0, 3_000_000];
  const sin = (degrees: number) => Math.sin((degrees * Math.PI) / 180);
  expect(sin(latitudeAtY(band, 1_500_000))).toBeCloseTo((sin(10) + sin(70)) / 2, 12);
  // High latitudes take less map height than low ones.
  const height = (from: number, to: number) =>
    northingAtLatitude(band, to) - northingAtLatitude(band, from);
  expect(height(60, 70)).toBeLessThan(height(10, 20) / 2);
});

it("inverts the projection and keeps regions on their parent's latitudes", () => {
  for (const latitudeProjection of [0, 1]) {
    const profile = atlasPhysicalProfile({
      southLatitude: -70,
      northLatitude: 70,
      latitudeProjection,
    });
    profile.WorldExtentY = [-2_000_000, 2_000_000];
    for (const latitude of [-70, -45, -3, 0, 12, 61, 70])
      expect(latitudeAtY(profile, northingAtLatitude(profile, latitude))).toBeCloseTo(latitude, 9);
    const region = createField(createWorldMesh([300_000, 500_000, 700_000, 900_000], 1024, 20_000));
    for (let i = 0; i < region.mesh.count; i += 29)
      if (region.mesh.membership(i) === 1)
        expect(latitudeAt(profile, region, i)).toBe(
          latitudeAtY(profile, region.mesh.y(i) + region.mesh.origin[1])
        );
  }
});

it("places a map without a world frame at its mid latitude", () => {
  const profile = atlasPhysicalProfile({
    southLatitude: 20,
    northLatitude: 60,
    latitudeProjection: 0,
  });
  const map = createField(createWorldMesh([0, 0, 400_000, 400_000], 256, 10_000));
  for (let i = 0; i < map.mesh.count; i += 11)
    if (map.mesh.membership(i) !== 0) expect(latitudeAt(profile, map, i)).toBe(40);
});

it("rejects a north edge south of the south edge", () => {
  expect(() => atlasParametersSchema.parse({ southLatitude: 40, northLatitude: 10 })).toThrow();
  expect(atlasParametersSchema.parse({})).toMatchObject({ southLatitude: 10, northLatitude: 70 });
});
