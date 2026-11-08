import { MapScale } from "@atlas/domain";
export const marineSettings = {
  // Settling distance of a sediment gravity flow on a shelf; steeper bed gradients sustain it.
  MarineSettlingLength: MapScale.length(0.025),
  MarineSuspensionGradient: 0.002,
};
