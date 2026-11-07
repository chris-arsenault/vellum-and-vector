/** What streams can do, whatever they work on. Imports nothing, so the profile can read it at load. */
export const streamSettings = {
  // How many times cutting is worked out per unit of span. A river cuts no further than its fall in one
  // working, so a lowering climbs one cell upstream each time: a longer span gets more of them.
  FluvialErosionStepsPerSpan: 13,
  // Metres of ordinary rock cut per unit of stream power, per unit of span.
  FluvialErosionRate: 4.16,
  FluvialEquilibriumGradient: 0.0015,
  // Stream power: water gathered to this exponent times slope, on this scale.
  FluvialAreaExponent: 0.5,
  FluvialPowerScale: 1548,
  // The runoff at which a square metre of ground sends down a square metre's worth of water.
  FluvialReferenceRunoff: 300,
  // A valley's width as a share of the square root of its catchment's area.
  FluvialValleyWidthShare: 0.05,
  // The share of a cell that streams too small to map lower, however small its catchment.
  FluvialDissectionShare: 0.3,
  // Square metres of catchment before a stream leaves a valley on record; smaller ones only wear the land.
  FluvialChannelArea: 3e9,
  // On a finer map, the share of the world's catchment a channel starts from beyond area alone,
  // and of the world's graded slope, since a coarse cell averages its valley with the ground around it.
  FluvialFineChannelShare: 1 / 3,
  FluvialFineGradientShare: 0.53,
};
