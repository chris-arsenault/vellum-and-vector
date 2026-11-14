import { MapScale } from "@atlas/domain";
/** What waves can do, resolved for the map before execution. */
export const coastSettings = {
  // Metres of ordinary rock worn per unit of wave forcing, per unit of span.
  CoastalWearRate: MapScale.length(1.5e-7),
  // How far below the sea waves cut their platform before they stop reaching it.
  CoastalPlatformDepth: MapScale.length(0.0000075),
};
