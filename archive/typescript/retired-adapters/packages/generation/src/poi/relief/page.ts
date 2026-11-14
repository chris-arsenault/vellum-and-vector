import type { PoiGroupPage } from "../poiContract";

export const reliefPage: PoiGroupPage = {
  id: "relief",
  name: "Relief",
  belongs:
    "Places defined by the shape and make of the solid ground: tops, cols, crests, steps, troughs, tablelands, cones, pits and domes, however they were made. Tectonics, ice, rivers, falling bodies and magic all raise or cut relief, so a glass flat or a sinkhole field belongs here beside a ridge: what they share is that the ground itself is different, and a route, a river or a carrier meets that difference.",
  excludes:
    "Standing and running water as such (a lake, a fall, a river mouth), coasts and the sea floor's currents, what lies in the ground without shaping it (a thermal vein, a placer, a killing ground), what grows on it, magic that shows in the air rather than the rock (an aurora field, a tear), and anything people built.",
};
