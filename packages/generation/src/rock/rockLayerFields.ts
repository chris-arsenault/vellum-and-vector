/**
 * How many layers a cell's rock column has, and the field bands that hold them. Change the slots
 * and the column, the field and its channels all follow. This file imports nothing, so the field
 * can read it at load.
 */
const slots = [0, 1, 2, 3, 4, 5, 6, 7] as const;
type Slot = (typeof slots)[number];
export const rockLayers = slots.length;
export const rockLayerKinds = slots.map(
  (slot) => `RockLayerKind${slot}` as const
) as readonly `RockLayerKind${Slot}`[];
export const rockLayerDepths = slots.map(
  (slot) => `RockLayerDepth${slot}` as const
) as readonly `RockLayerDepth${Slot}`[];
