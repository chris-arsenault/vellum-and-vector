/**
 * A river loses water through its bed wherever the ground under it is not already full: the
 * wider the river and the longer its way across such ground, the more goes down. Where the
 * ground is full the bed takes nothing, and the same full ground feeds the river as springs.
 * This is what lets a river thin across dry country and end short of the sea.
 */

/** A river's width in metres from its flow in cubic metres a second: wide as the root of it. */
export const channelWidth = (flow: number) => 4.7 * Math.sqrt(Math.max(0, flow));

/**
 * The flow, in cubic metres a second, a river loses crossing a stretch of ground. `leak` is
 * how fast the bed there takes water, in metres a second over the wetted bed; a river cannot
 * lose more than it carries.
 */
export function bedLoss(flow: number, leak: number, length: number) {
  if (!(flow > 0) || !(leak > 0) || !(length > 0)) return 0;
  return Math.min(flow, leak * channelWidth(flow) * length);
}
/**
 * How fast a bed takes water: as fast as open sand lets it where the ground is porous and
 * empty, not at all where it is tight or already full.
 */
export const bedLeak = (openBed: number, permeability: number, filled: number) =>
  Math.max(0, openBed) *
  Math.max(0, Math.min(1, permeability)) *
  (1 - Math.max(0, Math.min(1, filled)));
