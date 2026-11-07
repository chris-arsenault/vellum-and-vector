/** What ice can do, whatever it works on. Imports nothing, so the profile can read it at load. */
export const iceSettings = {
  // Metres a glacier cuts per unit of span, for each unit of its flux and thickness over the threshold.
  GlacialCutPerPower: 40,
  // How much of its power ice spends other than on cutting its bed.
  GlacialYield: 3.5,
};
