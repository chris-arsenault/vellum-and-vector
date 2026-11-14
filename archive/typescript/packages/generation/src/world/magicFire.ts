import { respond } from "../coupling/answers";

/**
 * What Fire has to say to the processes that shape land, through its own medium: the heat its field
 * carries. It quickens what goes on in the ground, and the heat it brings bakes rock buried under it.
 */
respond({
  key: "warmth",
  by: "fire",
  reads: ["Quickening"],
  scale: (map, i) => 1 + map.Quickening.get(i),
});
// The heat forcing is on the temperature's scale, ten to a degree; a full field's thousand is full heat.
respond({
  key: "heat",
  by: "fire",
  reads: ["ExternalHeatForcing"],
  add: (map, i) => Math.max(0, map.ExternalHeatForcing.get(i)) / 1000,
});
