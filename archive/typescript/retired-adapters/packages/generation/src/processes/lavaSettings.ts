import { MapScale } from "@atlas/domain";
export const lavaSettings = {
  // Yield stress divided by density and gravity, in metres; a coarse basalt approximation.
  LavaYieldHeight: MapScale.length(5e-9),
  // Distance over which an unrenewed pulse loses its mobility; renewed supply carries fresh heat.
  LavaCoolingDistance: MapScale.length(0.03),
};
