import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "../canonry/atlasProfile";
import { physicalContext } from "../canonry/context";
import { createField } from "../canonry/field";
import { physicalProfile } from "../canonry/profile";
import { units } from "../canonry/math";
import { rebuild } from "../canonry/surface";
import { createWorldMesh } from "../canonry/worldMesh";
import { wearAway } from "../rock/groundLedger";
import { compileMix } from "../rock/modes";
import { setLayer } from "../rock/rockColumn";
import { rockCatalogue } from "../rock/rockCatalogue";
import type { GroundProcess } from "./groundProcess";
import { actBy, groundProcesses, profileAtScale } from "./processCatalogue";

/** A process no part of the generator has heard of: nothing below it needed to change for it to work. */
const blowing = compileMix({ abrasion: 1 }),
  wind: GroundProcess = {
    id: "wind",
    statement: "Wind grinds whatever is not held down.",
    settings: {},
    run({ map, ground }) {
      for (let i = 0; i < map.mesh.count; i++)
        wearAway(map, i, ground.actOn(i, blowing, 1, Infinity));
    },
  };
function plain(tree: number) {
  const map = createField(createWorldMesh([-50_000, -50_000, 50_000, 50_000], 40, 25_000));
  for (let i = 0; i < map.mesh.count; i++) {
    setLayer(map, i, 0, rockCatalogue.shale.code, units(30_000));
    map.BedrockElevation.set(i, units(500));
    map.SedimentThickness.set(i, units(1));
    map.TreeCover.set(i, tree);
    rebuild(map, i);
  }
  actBy(wind)(map, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
  return map.Elevation.get(0) / 1024;
}
it("takes a new process with no change to rock, ground or any other process", () => {
  expect(plain(0)).toBeLessThan(501);
  // Roots hold against it for the reason they hold against rivers: it acts by abrasion.
  expect(plain(1)).toBeGreaterThan(plain(0));
});

it("assembles the profile from what each process says it owns", () => {
  for (const process of groundProcesses) expect(physicalProfile).toMatchObject(process.settings);
});
it("reads each process's settings at the map's scale", () => {
  const world = physicalProfile,
    region = profileAtScale(world, { scale: 0.1, passes: 4 });
  // A channel's catchment scales with area.
  // A finer map also resolves channels from less, since its cells see the channel itself.
  expect(region.FluvialChannelArea).toBeCloseTo((world.FluvialChannelArea * 0.01) / 3);
  expect(region.FluvialEquilibriumGradient).toBeCloseTo(world.FluvialEquilibriumGradient * 0.53);
  expect(region.DissolvedPerPass).toBeCloseTo(world.DissolvedPerPass / 4);
  // The World reads its own parameters unchanged.
  expect(profileAtScale(world, { scale: 1, passes: 1 })).toEqual(world);
});
