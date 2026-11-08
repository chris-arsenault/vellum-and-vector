import { MapScale } from "@atlas/domain";
export const weatheringSettings = {
  // Rock becoming loose cover on fully wet, warm, bare ground: metres per unit of span.
  WeatheringPerSpan: MapScale.length(0.00003),
  // Mantle depth that shields the rock beneath it, in metres.
  WeatheringShieldDepth: MapScale.length(0.00001),
};
