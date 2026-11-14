import { respond } from "../coupling/answers";

/**
 * What Aurora has to say to the processes that shape land, through its own medium: the charge its ice
 * holds. It stills what goes on in the ground, and charged ice weakens the bed it slides on.
 */
respond({
  key: "warmth",
  by: "aurora",
  reads: ["Stillness"],
  scale: (map, i) => Math.max(0, 1 - map.Stillness.get(i)),
});
respond({
  key: "iceBite",
  by: "aurora",
  reads: ["IceCharge"],
  scale: (map, i, { Profile: p }) => 1 + (p.ChargedIceErosion / 1000) * map.IceCharge.get(i),
});
