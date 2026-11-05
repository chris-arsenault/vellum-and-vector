import type { PhysicalContext } from "../canonry/context";
import type { PhysicalField } from "../canonry/field";
import { units } from "../canonry/math";
import { hashUnit, meshNoise } from "../canonry/noise";
import { rebuild } from "../canonry/surface";
import { changeLayer, deepestLayer, layDownRock, layerKind, setLayer } from "./rockColumn";
import { rockCatalogue, rockKindOfCode, type RockKindId } from "./rockCatalogue";

/** Sediment this deep starts turning to rock, and what stays loose on top, in metres. */
const lithifyFrom = 20,
  looseCover = 5;
/** Water shallow and warm enough to build limestone, in metres and native temperature. */
const reefDepth = 200,
  reefWarmth = 480;
/** The rain below which a closed basin dries to salt, in native units. */
const dryBasin = 400;
/** A pass of mountain building this strong, in metres, bakes what it buries. */
const bakingConstruction = 120;
/** How strongly each influence pushes rock on toward its next form, per pass. */
const burialOdds = 0.9,
  sutureOdds = 0.5;
const salts = {
  platform: 0x5a11,
  depth: 0x5a12,
  shield: 0x5a13,
  bake: 0x5a14,
};

const platforms: readonly (readonly RockKindId[])[] = [
  ["limestone", "shale", "sandstone"],
  ["sandstone", "shale", "limestone"],
  ["shale", "sandstone", "limestone"],
  ["sandstone", "limestone", "shale"],
];
/** Old continental crust, and whether it has been planed down to its basement. */
function continentalColumn(map: PhysicalField, c: PhysicalContext, i: number) {
  const province = map.CrustProvinceIds.get(i),
    shield = hashUnit(c.Seed ^ salts.shield, province, 0) < 0.3,
    basement = hashUnit(c.Seed ^ salts.shield, province, 1) < 0.5 ? "gneiss" : "granite";
  if (shield) {
    map.RockKindCodes.set(i, rockCatalogue[basement].code);
    setLayer(map, i, 0, rockCatalogue[basement].code, units(30_000));
    return;
  }
  const stack = platforms[Math.floor(hashUnit(c.Seed ^ salts.platform, province, 0) * 4)],
    swell =
      1 + 0.6 * meshNoise(map.mesh, map.mesh.x(i), map.mesh.y(i), c.Seed ^ salts.depth, 180_000, 2);
  stack.forEach((kind, layer) =>
    setLayer(map, i, layer, rockCatalogue[kind].code, units((150 + 450 * layer) * swell))
  );
  setLayer(map, i, stack.length, rockCatalogue[basement].code, units(30_000));
}
export function oceanicColumn(map: PhysicalField, i: number) {
  setLayer(map, i, 0, rockCatalogue.basalt.code, units(8000));
}
/** The rock the crust starts with, before anything has happened to it. */
export function initializeRock(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.CrustContinentalFraction.get(i) >= 500) continentalColumn(map, c, i);
    else oceanicColumn(map, i);
    const exposed = rockKindOfCode(map.RockLayerKind0.get(i));
    map.RockKindCodes.set(i, exposed.code);
    map.RockResistance.set(i, exposed.resistance);
  }
}

/** What loose sediment becomes where it lies: the water and the weather decide. */
function sedimentKind(map: PhysicalField, i: number): RockKindId {
  const water = map.WaterKindCodes.get(i);
  if (water === 1)
    return map.WaterDepths.get(i) < units(reefDepth) && map.Temperature.get(i) > reefWarmth
      ? "limestone"
      : "shale";
  if (water === 2) return map.Rainfall.get(i) < dryBasin ? "saltbed" : "shale";
  return "sandstone";
}
/** Sediment buried under more of itself turns to rock of the kind its setting makes. */
export function lithification(map: PhysicalField) {
  const from = units(lithifyFrom),
    keep = units(looseCover);
  for (let i = 0; i < map.mesh.count; i++) {
    const sediment = map.SedimentThickness.get(i);
    if (sediment < from) continue;
    const amount = sediment - keep;
    map.SedimentThickness.add(i, -amount);
    map.BedrockElevation.add(i, amount);
    map.SurfaceRockLoad.add(i, amount);
    layDownRock(map, i, rockCatalogue[sedimentKind(map, i)], amount);
    rebuild(map, i);
  }
}
function bake(map: PhysicalField, c: PhysicalContext, i: number, odds: number) {
  const deepest = deepestLayer(map, i);
  for (let layer = 0; layer <= deepest; layer++) {
    const next = rockKindOfCode(layerKind(map, i, layer)).underHeat;
    // Deeper layers feel it first; the surface only under the strongest building.
    const felt = odds * (0.4 + (0.6 * layer) / Math.max(1, deepest));
    if (next && hashUnit(c.EpochStableSeed ^ salts.bake ^ (c.EpochIndex << 16), i, layer) < felt)
      changeLayer(map, i, layer, rockCatalogue[next]);
  }
}
/** Burial and heat: rock under a range and along old sutures turns to its next form. */
export function metamorphism(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const built = map.OrogenicConstruction.get(i) / units(bakingConstruction),
      suture = map.CrustSutureStrength.get(i) / 1000,
      odds = Math.max(Math.min(burialOdds, built), suture * sutureOdds);
    if (odds > 0) bake(map, c, i, odds);
  }
}
