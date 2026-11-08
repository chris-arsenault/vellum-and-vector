/** What slopes can do. Imports nothing, so the profile can read it at load. */
export const slopeSettings = {
  // Numerical: the most rounds of failure a pass resolves, and the share of the first round's movement
  // below which the ground counts as standing.
  SlopeRoundsAtMost: 24,
  SlopeRoundsSettled: 0.05,
  // Rise/run: about 35 degrees for ordinary rock, varied by what the ground is.
  MassWastingStableGradient: 0.7,
  // Reference metres for unresolved hillslope profiles and moraine accommodation. This is not
  // the distance between resolved terrain samples used by mass failure.
  HillslopeLength: 1000,
};
