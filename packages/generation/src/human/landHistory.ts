import { MapScale, type Band } from "@atlas/domain";
import { defineCommand, runOperation } from "../processOperation";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { compileLayerMix } from "./layerCatalogue";
import { buryHumanLayers, reExposeRemains, wearHumanLayers } from "./layerOperations";
import { working } from "./landWork";

/**
 * How the land's own history reaches people's layers. No physical process knows the layers
 * exist: each epoch the land is looked at before its processes run and again after, and what
 * its cumulative records say was laid down, stripped off or struck in between is what buried,
 * uncovered or wrecked what stood there. Water over a cell buries it; ice across it scours.
 */
/** Records of ground laid over a cell, of ground taken off it, and of a strike on it. */
const laid: PhysicalBufferName[] = [
  "CumulativeDeposition",
  "CumulativeGlacialDeposition",
  "VolcanicConstructionHistory",
  "ImpactEjectaThickness",
];
// A river's record is the depth of its channel, cut in a strip of the cell; it bares nothing
// beside the channel and is left out.
const stripped: PhysicalBufferName[] = ["CumulativeGlacialErosion", "CumulativeCoastalErosion"];
const struck: PhysicalBufferName[] = ["ImpactExcavation"];
/** The metres of new ground under which a place is gone, and of stripping that bares it. */
const metresThatBury = 3;
const scouring = compileLayerMix({ scour: 1 });
const striking = compileLayerMix({ shake: 0.5, burn: 0.5 });

interface Seen {
  laid: Band;
  stripped: Band;
  struck: Band;
}
// hpc-exempt: one look at the land per map and epoch, replaced at the next.
const seen = new WeakMap<PhysicalField, Seen>();
const metres = (map: PhysicalField, names: PhysicalBufferName[], cell: number) => {
  let total = 0;
  for (const name of names) total += map[name].get(cell);
  return MapScale.metres(total, "native");
};
function look(map: PhysicalField, into: Seen) {
  for (let cell = 0; cell < map.mesh.count; cell++) {
    into.laid.set(cell, metres(map, laid, cell));
    into.stripped.set(cell, metres(map, stripped, cell));
    into.struck.set(cell, metres(map, struck, cell));
  }
}
/** The land as it stands before an epoch's processes run. */
export const watchLand = defineCommand(
  "human.land.watch",
  "event",
  ({ map }: { map: PhysicalField }) => {
    let before = seen.get(map);
    if (!before) {
      const kept = (name: string) => {
        const band = working(map, name);
        band.retain();
        return band;
      };
      seen.set(
        map,
        (before = { laid: kept("laid"), stripped: kept("stripped"), struck: kept("struck") })
      );
    }
    look(map, before);
  },
  []
);
const since = (now: number, before: number) =>
  1 - Math.exp(-Math.max(0, now - before) / metresThatBury);
/** What the land did since it was last looked at is done to what stood on it. */
export const meetLand = defineCommand(
  "human.land.meet",
  "event",
  ({ map }: { map: PhysicalField }) => {
    const before = seen.get(map),
      covered = working(map, "covered"),
      bared = working(map, "bared"),
      wrecked = working(map, "wrecked"),
      scoured = working(map, "scoured"),
      thick = map.scale.length(0.00025);
    for (let cell = 0; cell < map.mesh.count; cell++) {
      const under = map.WaterKindCodes.get(cell) !== 0;
      scoured.set(cell, map.IceThickness.get(cell) / thick);
      covered.set(cell, under ? 1 : 0);
      if (!before) continue;
      if (!under) covered.set(cell, since(metres(map, laid, cell), before.laid.get(cell)));
      bared.set(cell, since(metres(map, stripped, cell), before.stripped.get(cell)));
      wrecked.set(cell, Math.max(0, metres(map, struck, cell) - before.struck.get(cell)));
    }
    runOperation(map, wearHumanLayers, { map, mix: striking, intensity: wrecked });
    runOperation(map, wearHumanLayers, { map, mix: scouring, intensity: scoured });
    runOperation(map, buryHumanLayers, { map, share: covered });
    runOperation(map, reExposeRemains, { map, share: bared });
    for (const band of [covered, bared, wrecked, scoured]) map.coverage.release(band);
    if (before) look(map, before);
  },
  []
);
