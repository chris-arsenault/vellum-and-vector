/** What water can dissolve. Imports nothing, so the profile can read it at load. */
export const solutionSettings = {
  // How far water lowers fully soluble rock on a pass, in metres at full runoff.
  DissolvedPerPass: 80,
  // The runoff at which water takes all the soluble rock it can on a pass.
  DissolvedFullRunoff: 1000,
};
