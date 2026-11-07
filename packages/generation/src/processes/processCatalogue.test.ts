import { expect, it, vi } from "vitest";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { createField } from "../world/field";
import { physicalProfile } from "../world/profile";
import { units } from "../world/math";
import { rebuild } from "../world/surface";
import { createWorldMesh } from "../world/worldMesh";
import { compileMix } from "../rock/modes";
import { setLayer } from "../rock/rockColumn";
import { rockCatalogue } from "../rock/rockCatalogue";
import { defineProcess } from "./groundProcess";
import { actBy, groundProcesses, profileAtScale } from "./processCatalogue";

/** A process no part of the generator has heard of: nothing below it needed to change for it to work. */
const blowing = compileMix({ abrasion: 1 }),
  wind = defineProcess({
    id: "wind",
    statement: "Wind grinds whatever is not held down.",
    reads: [],
    asks: [],
    moves: [["loose", "load"]],
    settings: {},
    run({ field, ground, wear }) {
      for (let i = 0; i < field.mesh.count; i++)
        wear.demand(
          { id: "wind", remembers: "CumulativeFluvialErosion" },
          i,
          ground.actOn(i, blowing, 1, Infinity)
        );
    },
  });
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

it("runs a process on the view it declared, with no way to the rest of the field", () => {
  const work = vi.fn(),
    probe = defineProcess({
      id: "probe",
      statement: "Looks at what it is handed.",
      reads: [],
      asks: [],
      moves: [],
      settings: {},
      run: work,
    });
  const map = createField(createWorldMesh([-50_000, -50_000, 50_000, 50_000], 40, 25_000));
  actBy(probe)(map, physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1));
  expect(Object.keys(work.mock.calls[0][0])).not.toContain("world");
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
  expect(region.DissolvedPerSpan).toBeCloseTo(world.DissolvedPerSpan / 4);
  // The World reads its own parameters unchanged.
  expect(profileAtScale(world, { scale: 1, passes: 1 })).toEqual(world);
});
