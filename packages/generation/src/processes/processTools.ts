import type { Band } from "@atlas/domain";
import { depositShoreLoads, recordCoastalCut } from "../world/coastalEvolution";
import { coastalFrame, type CoastalFrame } from "../world/coastalFrame";
import type { PhysicalContext } from "../world/context";
import { drainageConditioning } from "../world/drainageFlood";
import type { PhysicalField, PhysicalBufferName } from "../world/field";
import { waterGathered } from "../world/flowGraph";
import { resolveLandTargets } from "../world/flowGuidance";
import { iceCanCut, refreshGrounding, slidingSpeed } from "../world/glacierSurface";
import { releaseWorking, workingArray } from "../world/physicalNumerics";
import type { PhysicalProfile } from "../world/profile";
import { hillslopeFlux } from "./slopeFlux";

/**
 * What a process may do beyond its declared bands. Each of these answers a question or makes one move
 * on the ground; together they are the whole of a process's reach, and none of them hands out the field.
 */
export interface ProcessTools {
  /** A working band of this map's cells, cleared, to hand back through `release`. */
  scratch(name: string): Band;
  release(...bands: Band[]): void;
  /** What fails between cells this pass: `cuts` to shed and `fills` to settle, by volume. */
  slopeFailure(settings: PhysicalProfile): { cuts: Band; fills: Band };
  /** Works out afresh where water drains to, as the land stands now. */
  conditionDrainage(context: PhysicalContext): void;
  /** Each land cell's next cell downstream, which the caller hands back through `release`. */
  landTargets(context: PhysicalContext): Band;
  /** The water that reaches each cell down those targets. */
  waterGathered(targets: Band, rain: Band): Band;
  /** How fast ice slides through a cell, in metres a year. */
  iceSpeed(i: number): number;
  /** How far ice can lower its bed here while it still slides on it, in height units. */
  iceCanCut(i: number, settings: PhysicalProfile): number;
  /** Works out afresh which ice stands on its bed. */
  refreshGrounding(settings: PhysicalProfile): void;
  /** The shore waves reach, from the energy of the waves at sea or the given forcing on land. */
  shoreFrame(width: number, waves: Band, forcing?: Band): CoastalFrame;
  /** Waves take a cut off a cell, and say the volume it comes to. */
  coastCut(i: number, cut: number): number;
  /** What waves took comes to rest where the shore shelters it, in what room it has. */
  depositShoreLoads(
    context: PhysicalContext,
    frame: CoastalFrame,
    loads: Band,
    oceanOnly: boolean
  ): void;
  /** Clears a band, for forcing that has been spent. */
  clear(band: PhysicalBufferName): void;
}
export const toolsFor = (map: PhysicalField): ProcessTools => ({
  scratch: (name) => workingArray(map, "float64", name).fill(0),
  release: (...bands) => releaseWorking(map, ...bands),
  slopeFailure: (settings) => hillslopeFlux(map, settings),
  conditionDrainage: (context) => drainageConditioning(map, context),
  landTargets: (context) => resolveLandTargets(map, context),
  waterGathered: (targets, rain) => waterGathered(map, targets, rain),
  iceSpeed: (i) => slidingSpeed(map, i),
  iceCanCut: (i, settings) => iceCanCut(map, i, settings),
  refreshGrounding: (settings) => refreshGrounding(map, settings),
  shoreFrame: (width, waves, forcing) => coastalFrame(map, width, waves, forcing),
  coastCut: (i, cut) => recordCoastalCut(map, i, cut),
  depositShoreLoads: (context, frame, loads, oceanOnly) =>
    depositShoreLoads(map, context, frame, loads, oceanOnly),
  clear: (band) => map[band].fill(0),
});
