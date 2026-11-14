import { MapScale } from "@atlas/domain";

/**
 * What makes a river on a map. Water runs over all wet ground in channels too small for a
 * map; those are quantities on its cells. A river is water gathered from a catchment the map
 * can show, in an amount that matters at the map's scale. Both sizes are declared against
 * the map, so every map is the same kind of map of its own country: a finer map shows smaller
 * rivers, and a map with more cells shows the same rivers in more detail (ADR 0005:
 * "relative declarations resolved by the shared `MapScale` against the map's actual frame";
 * "a per-map cell minimum alone would name every resolved fragment of a finer map").
 *
 * These are the one statement of a river's size. The river network, a region's starting
 * network and the test for drawing a river all read them here.
 */

/** The flow that makes a river, as a share of the map's own measure. */
export const riverDischarge = MapScale.volume(5.46875e-18);
/** The catchment a river's water is gathered from, as a share of the map's area. */
export const riverCatchment = MapScale.area(0.00125);

/** The two sizes on one map: cubic metres a second, and square metres. */
export const riverSizes = (scale: MapScale) => ({
  discharge: scale.resolveMeasure(riverDischarge),
  catchment: scale.resolveMeasure(riverCatchment),
});
/**
 * Whether water at a place is a river's: it has been gathered from a catchment the map
 * shows. A cell that sheds a great deal of its own water is wet ground, not a river.
 */
// owner-direction(2026-11-12): a cell's own yield, however large, never makes it a river.
export const gathered = (catchment: number, sizes: { catchment: number }, ownArea: number) =>
  catchment > ownArea && catchment >= sizes.catchment;
