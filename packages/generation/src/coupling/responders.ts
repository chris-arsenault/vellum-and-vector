import { clamp } from "../world/math";
import { respond } from "./answers";

/** Everything with something to say about what processes ask. Registering here edits no process. */
/** Temperature is ten native units per degree, with freezing at 300. */
const freezing = 300,
  warm = 200,
  frostBand = 100;

respond({
  key: "runoff",
  by: "climate",
  reads: ["Runoff"],
  base: (map, i, { Profile: p }) => map.Runoff.get(i) / p.FluvialReferenceRunoff,
});
respond({
  key: "runoff",
  by: "ice melt",
  reads: ["GlacialMeltwater"],
  add: (map, i, { Profile: p }) => map.GlacialMeltwater.get(i) / p.FluvialReferenceRunoff,
});
respond({
  key: "wetness",
  by: "climate",
  reads: ["Runoff"],
  base: (map, i, { Profile: p }) => map.Runoff.get(i) / (p.FluvialReferenceRunoff * 2),
});
respond({
  key: "wetness",
  by: "wetlands",
  reads: ["WetlandCover"],
  add: (map, i) => map.WetlandCover.get(i) * 0.5,
});
// Salt crystals wedge rock apart, so salted ground weathers as if wetter.
respond({
  key: "wetness",
  by: "salt",
  reads: ["Salting"],
  add: (map, i) => map.Salting.get(i) * 0.5,
});
respond({
  key: "warmth",
  by: "climate",
  reads: ["Temperature"],
  base: (map, i) => Math.max(0, map.Temperature.get(i) - freezing) / warm,
});
// Fire quickens what goes on in the ground, Aurora stills it.
respond({
  key: "warmth",
  by: "fire",
  reads: ["Quickening"],
  scale: (map, i) => 1 + map.Quickening.get(i),
});
respond({
  key: "warmth",
  by: "aurora",
  reads: ["Stillness"],
  scale: (map, i) => Math.max(0, 1 - map.Stillness.get(i)),
});
// How hard sliding ice bites its bed, against plain ice's 1. Charge in the ice weakens what it touches.
respond({ key: "iceBite", by: "plain ice", reads: [], base: () => 1 });
respond({
  key: "iceBite",
  by: "aurora",
  reads: ["IceCharge"],
  scale: (map, i, { Profile: p }) => 1 + (p.ChargedIceErosion / 1000) * map.IceCharge.get(i),
});
// Ground that crosses freezing again and again is opened by frost, if it has water to freeze.
respond({
  key: "frost",
  by: "climate",
  reads: ["Temperature", "Rainfall"],
  base: (map, i, { Profile: p }) =>
    clamp(1 - Math.abs(map.Temperature.get(i) - freezing) / frostBand, 0, 1) *
    clamp(map.Rainfall.get(i) / p.FluvialReferenceRunoff, 0, 1),
});
