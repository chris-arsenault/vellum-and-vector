import { humanLayers } from "@atlas/domain";
import { respond } from "../coupling/answers";
import type { PhysicalField } from "../world/field";

/**
 * What the land feeds, answered per cell as people per square kilometre. Three yields say what
 * a cell would feed under crops, under herds and left wild; `support` is what it feeds as its
 * area is used now. Magic and works change a yield by responding to it; nothing here names
 * them.
 */
const dry = (map: PhysicalField, i: number) => map.WaterKindCodes.get(i) === 0;
/** How far the cell's warmth is from the growing season's best, 0 to 1. */
const growing = (map: PhysicalField, i: number) =>
  Math.exp(-Math.pow((map.Temperature.get(i) - 480) / 200, 2));
/** The water the soil holds against what it could hold. */
function storedWater(map: PhysicalField, i: number) {
  const carbon = Math.min(1, map.SoilCarbon.get(i) / 30),
    capacity = map.SoilDepth.get(i) * (0.12 + carbon * 0.15);
  return capacity > 0 ? Math.min(1, map.SoilWater.get(i) / capacity) : 0;
}
const river = (map: PhysicalField, i: number) =>
  map.RiverOrders.get(i) > 0 ? Math.min(1, map.RiverChannelStrength.get(i) / 1000) : 0;
/** Thick ice leaves nothing to live on. */
const iceFree = (map: PhysicalField, i: number) =>
  1 - Math.min(1, map.IceThickness.get(i) / map.scale.length(0.00025));
const quickened = (map: PhysicalField, i: number, stilled: number) =>
  (1 + 0.5 * map.Quickening.get(i)) * (1 - stilled * map.Stillness.get(i));
/** The catch a shore lands from the sea beside it: the sea's life, more where a front upwells. */
function shoreCatch(map: PhysicalField, i: number) {
  let seas = 0,
    fauna = 0,
    upwelling = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0 || map.WaterKindCodes.get(j) !== 1) continue;
    seas++;
    fauna += map.AquaticFauna.get(j);
    upwelling = Math.max(upwelling, map.Upwelling.get(j) / 1000);
  }
  return seas ? 0.5 + (4 * fauna) / seas + 2 * upwelling : 0;
}

respond({
  key: "cropYield",
  by: "soil, water and season",
  reads: [
    "WaterKindCodes",
    "Temperature",
    "Moisture",
    "SoilDepth",
    "SoilWater",
    "SoilCarbon",
    "Slope",
    "TreeCover",
    "RiverOrders",
    "RiverChannelStrength",
    "Quickening",
    "Stillness",
    "IceThickness",
  ],
  base(map, i) {
    if (!dry(map, i)) return 0;
    const soil = Math.min(1, map.SoilDepth.get(i) / map.scale.length(1.25e-7)),
      water = Math.min(1, Math.max(map.Moisture.get(i) / 1000, river(map, i), storedWater(map, i)));
    return (
      35 *
      growing(map, i) *
      soil *
      water *
      Math.exp(-12 * map.Slope.get(i)) *
      (1 - 0.8 * map.TreeCover.get(i)) *
      quickened(map, i, 0.8) *
      iceFree(map, i)
    );
  },
});
respond({
  key: "herdYield",
  by: "grass and season",
  reads: ["WaterKindCodes", "Temperature", "GrassCover", "Quickening", "Stillness", "IceThickness"],
  base: (map, i) =>
    dry(map, i)
      ? 5 * map.GrassCover.get(i) * growing(map, i) * quickened(map, i, 0.5) * iceFree(map, i)
      : 0,
});
respond({
  key: "wildYield",
  by: "woods, game and water",
  reads: [
    "WaterKindCodes",
    "TreeCover",
    "Productivity",
    "Herbivores",
    "AquaticFauna",
    "Upwelling",
    "RiverOrders",
    "RiverChannelStrength",
    "IceThickness",
  ],
  base(map, i) {
    if (!dry(map, i)) return 0;
    const gathered =
        2 * map.TreeCover.get(i) * Math.min(1, 3 * Math.max(0, map.Productivity.get(i))) +
        2 * map.Herbivores.get(i),
      fished = river(map, i) * (0.5 + 4 * map.AquaticFauna.get(i)) + shoreCatch(map, i);
    return (gathered + fished) * iceFree(map, i);
  },
});
respond({
  key: "support",
  by: "the land as it is used",
  reads: [humanLayers.farmland, humanLayers.pasture, humanLayers.builtUp],
  answers: ["cropYield", "herdYield", "wildYield"],
  base(map, i, _, answer) {
    const crops = map[humanLayers.farmland].get(i),
      herds = map[humanLayers.pasture].get(i),
      wild = Math.max(0, 1 - crops - herds - map[humanLayers.builtUp].get(i));
    return crops * answer("cropYield") + herds * answer("herdYield") + wild * answer("wildYield");
  },
});
