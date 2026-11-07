/** What ice can do, whatever it works on. Imports nothing, so the profile can read it at load. */
export const iceSettings = {
  // Metres of ordinary rock ice cuts per unit of span, for each metre a year it slides.
  GlacialCutPerSpeed: 0.2,
  // Ice sliding no faster than this, in metres a year, is frozen to its bed and cuts nothing.
  GlacierFrozenSpeed: 5,
  // How high ice stands against its own spreading, per square root of a metre from its edge: ice yields
  // at about a bar, which is near 3 km of ice a few hundred km in from its margin.
  IceYieldHeight: 4.7,
};
