import { magicSystemSchema } from "./magicSystems";
import { at, covers, feature, land } from "./magicPresetHelpers";

/**
 * Veil: a door needs a house. Derived from the strain between every other system, it is
 * placed last so its evaluation reads the epoch's fields. A tear that shifts is a wild
 * zone; stable tears far apart pair into doors.
 */
export const veilPreset = magicSystemSchema.parse({
  id: "veil",
  name: "Veil",
  origins: [
    { id: "tear", source: "strain", propagation: "local", renewal: "emergent" },
    { id: "door", source: "pairing", propagation: "local", renewal: "emergent" },
  ],
  phase: "post-glacial",
  parameters: {},
  effects: { tearing: 1 },
  // A tear is what the strain is now; nothing of it is stored between epochs.
  history: { retention: 0, storage: 0 },
  features: [
    feature("tear", "Tear", 50, [[land, at("intensity", 300)]], undefined, covers(300, 1000)),
    // The share of a tear that moved since the last epoch: ground the map cannot trust.
    feature("wild", "Wild zone", 75, [[land, at("wild", 0.3), at("intensity", 100)]]),
    feature("door", "Door", 95, [[land, at("source:door", 1)]]),
  ],
});
