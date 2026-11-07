import type { PhysicalContext } from "../canonry/context";
import type { PhysicalField } from "../canonry/field";
import { units } from "../canonry/math";
import { hashUnit, meshNoise } from "../canonry/noise";
import { rebuild } from "../canonry/surface";
import { raiseRock } from "./groundLedger";
import { changeLayer, deepestLayer, layBed, layerDepth, layerKind, setLayer } from "./rockColumn";
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
/** Metres down that the fullest heat reaches, and how much of a full heat an old suture carries. */
const bakingDepth = 1200,
  fullHeat = 1,
  sutureHeat = 0.5;
const salts = {
  platform: 0x5a11,
  depth: 0x5a12,
  shield: 0x5a13,
};

/**
 * A continental platform's beds, top first: kilometres of alternating sediment from the seas that
 * came and went over it, so that a thrust cutting through them has something to bring up.
 */
const platforms: readonly (readonly RockKindId[])[] = [
  ["limestone", "shale", "sandstone", "shale", "limestone"],
  ["sandstone", "shale", "limestone", "sandstone", "shale"],
  ["shale", "sandstone", "limestone", "shale", "sandstone"],
  ["sandstone", "limestone", "shale", "limestone", "sandstone"],
];
/** How thick each bed of a platform is at its thinnest, in metres: thicker with depth. */
const bedThickness = [300, 600, 900, 1200, 1500];
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
    setLayer(map, i, layer, rockCatalogue[kind].code, units(bedThickness[layer] * swell))
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
    raiseRock(map, i, amount, "lithification", "loose");
    layBed(map, i, rockCatalogue[sedimentKind(map, i)], amount);
    rebuild(map, i);
  }
}
/** Rock this far down turns to its next form under the fullest heat, and deeper under less. */
function bake(map: PhysicalField, i: number, heat: number) {
  const deepest = deepestLayer(map, i),
    reaches = units(bakingDepth) / heat;
  let above = 0;
  for (let layer = 0; layer <= deepest; layer++) {
    if (above >= reaches) {
      const next = rockKindOfCode(layerKind(map, i, layer)).underHeat;
      if (next) changeLayer(map, i, layer, rockCatalogue[next]);
    }
    above += layerDepth(map, i, layer);
  }
}
/**
 * Burial and heat: rock deep under a range or an old suture turns to its next form, whatever its
 * neighbours do, because grade is how deep and how hot it has been. Nothing at the surface bakes; it
 * shows only once erosion and thrusts have brought it up, so grade comes to the surface in zones
 * along the belt, highest where the most has been stripped.
 */
export function metamorphism(map: PhysicalField) {
  for (let i = 0; i < map.mesh.count; i++) {
    const built = map.OrogenicConstruction.get(i) / units(bakingConstruction),
      suture = map.CrustSutureStrength.get(i) / 1000,
      heat = Math.max(Math.min(fullHeat, built), suture * sutureHeat);
    if (heat > 0) bake(map, i, heat);
  }
}
