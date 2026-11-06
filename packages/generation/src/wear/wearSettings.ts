/**
 * What each wearing process can do, whatever it works on. How rock answers is the catalogue's; these
 * are the process's own powers and reach. They join the physical profile, so a run's configuration
 * reads them with the rest. This file imports nothing, so the profile can read it at load.
 */
export const streamSettings = {
  FluvialErosionIterations: 13,
  FluvialErosionStrength: 0.32,
  FluvialEquilibriumGradient: 0.0015,
  // Stream power: catchment to this exponent times slope, on this scale, per iteration.
  FluvialAreaExponent: 0.5,
  FluvialPowerScale: 1548,
  MaximumFluvialCutPerIteration: 60,
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
export const solutionSettings = {
  // How far water lowers fully soluble rock on a pass, in metres at full runoff.
  DissolvedPerPass: 80,
  // The runoff at which water takes all the soluble rock it can on a pass.
  DissolvedFullRunoff: 1000,
};
export const iceSettings = {
  MaximumGlacialErosionPerPass: 150,
  // Metres a glacier cuts per pass for each unit of its flux and thickness over the threshold.
  GlacialCutPerPower: 40,
  // How much of its power ice spends other than on cutting its bed.
  GlacialYield: 3.5,
};
export const slopeSettings = {
  MassWastingIterations: 4,
  PostFluvialMassWastingIterations: 2,
  // Rise/run: about 35 degrees for baseline rock, varied by material resistance.
  MassWastingStableGradient: 0.7,
  MassWastingTransportLength: 10_000,
  MassWastingTransportFraction: 280,
  // Cubic metres per metre of contour width in one physical relaxation pass.
  MaximumHillslopeTransport: 550_000,
  // Metres from a channel bank to where a hillslope rounds over. A cell wider than this is mostly
  // gentler ground, so the step between two cells climbs one hillslope, not the cell's width.
  HillslopeLength: 1000,
};
