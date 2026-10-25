import { magicSystemSchema } from "./magicSystems";
import { at, covers, feature, land } from "./magicPresetHelpers";

/**
 * Hallowed: the ground on which nothing is harmed. Made by people where they have lived
 * long and where they keep a line; wards every other system inside its rings and lays what
 * it held back on the rim. A society-phase system: evaluated while people act, lapsing to
 * its stored charge between, so an abandoned sanctuary fades.
 */
export const hallowedPreset = magicSystemSchema.parse({
  id: "hallowed",
  name: "Hallowed",
  origins: [
    // Seats: person-years on a seat's cell, stronger where many ways converge on it.
    { id: "seat", source: "tenure", propagation: "ward", renewal: "kept" },
    // Lines: frontiers kept and works maintained, and the roads pilgrims wear.
    { id: "line", source: "kept-line", propagation: "ward", renewal: "kept" },
  ],
  phase: "society",
  parameters: {},
  // Warding is its medium; pinned beds inside are its own resistance.
  effects: { warding: 1, rockResistance: 300 },
  // A kept ward holds; an unkept one loses three tenths an epoch.
  history: { retention: 0.7, storage: 0.5 },
  features: [
    feature(
      "ring",
      "Sanctuary ring",
      88,
      [[land, at("intensity", 300)]],
      [[land, at("intensity", 150)]],
      covers(150, 1000)
    ),
    feature("line", "Ward line", 86, [[land, at("source:line", 1), at("intensity", 100)]]),
    // A seat nobody keeps fades by the history's retention: its ring thins in coverage until
    // it is gone, so the fading halo is the ring itself at low coverage.
  ],
});
