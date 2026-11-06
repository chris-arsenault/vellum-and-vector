/** What failing slopes can do. Imports nothing, so the profile can read it at load. */
export const slopeSettings = {
  MassWastingIterations: 4,
  PostFluvialMassWastingIterations: 2,
  // Rise/run: about 35 degrees for ordinary rock, varied by what the ground is.
  MassWastingStableGradient: 0.7,
  MassWastingTransportLength: 10_000,
  MassWastingTransportFraction: 280,
  // Cubic metres per metre of contour width in one physical relaxation pass.
  MaximumHillslopeTransport: 550_000,
  // Metres from a channel bank to where a hillslope rounds over. A cell wider than this is mostly
  // gentler ground, so the step between two cells climbs one hillslope, not the cell's width.
  HillslopeLength: 1000,
};
