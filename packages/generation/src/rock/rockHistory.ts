import { ask, respond } from "../coupling/answers";
import { MapScale } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import type { PhysicalField } from "../world/field";
import { units } from "../world/math";
import { hashUnit, meshNoise } from "../world/noise";
import { constructRock, lithifyBuried } from "./groundLedger";
import { deepestLayer, layerDepth, readLayer, setLayer } from "./rockColumn";
import { heatedMaterial } from "./modes";
import { coverColumn, columnThickness, facetShare, projectGround } from "./groundShares";
import { rockCatalogue, type RockKindId } from "./rockCatalogue";

/**
 * What lies buried deeper than this map-relative depth is under enough weight to turn to rock; what is above it
 * stays loose however long it lies. Of what is deep enough, this share is still loose after a span.
 */
const lithifyFrom = 0.00025,
  stillLoosePerSpan = 0.5;
/** Annual rainfall depth as a fraction of map span. */
const dryBasin = 1e-7;
/** Relative salt thickness a closed basin lays down per unit of span. */
const saltPerSpan = 0.000025;
/** Relative construction depth at which mountain building bakes what it buries. */
const bakingConstruction = 0.00003;
/** Relative depth reached by full heat, and the share carried by an old suture. */
// length-unit: fraction
const bakingDepth = 0.0003,
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
/** Minimum platform bed thickness as map-length fractions, increasing with depth. */
// length-unit: fraction
const bedThickness = [0.000075, 0.00015, 0.000225, 0.0003, 0.000375];
/** Old continental crust, and whether it has been planed down to its basement. */
function continentalColumn(map: PhysicalField, c: PhysicalContext, i: number) {
  const province = map.CrustProvinceIds.get(i),
    shield = hashUnit(c.Seed ^ salts.shield, province, 0) < 0.3,
    basement = hashUnit(c.Seed ^ salts.shield, province, 1) < 0.5 ? "gneiss" : "granite";
  if (shield) {
    setLayer(map, i, 0, rockCatalogue[basement].code, units(map.scale.length(0.0075)));
    return;
  }
  const stack = platforms[Math.floor(hashUnit(c.Seed ^ salts.platform, province, 0) * 4)],
    swell =
      1 +
      0.6 *
        meshNoise(
          map.mesh,
          map.mesh.x(i),
          map.mesh.y(i),
          c.Seed ^ salts.depth,
          map.scale.length(0.045),
          2
        );
  stack.forEach((kind, layer) =>
    setLayer(
      map,
      i,
      layer,
      rockCatalogue[kind].code,
      units(map.scale.length(bedThickness[layer]) * swell)
    )
  );
  setLayer(map, i, stack.length, rockCatalogue[basement].code, units(map.scale.length(0.0075)));
}
export function oceanicColumn(map: PhysicalField, i: number) {
  setLayer(map, i, 0, rockCatalogue.basalt.code, units(map.scale.length(0.002)));
}
/** The rock the crust starts with, before anything has happened to it. */
export function initializeRock(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.CrustContinentalFraction.get(i) >= 500) continentalColumn(map, c, i);
    else oceanicColumn(map, i);
    projectGround(map, i);
  }
}

/**
 * Water with no way out and little rain to replace it dries, and what it held stays as salt. A sea cut
 * off when its ocean closes lays down a bed this way with no river bringing anything to it, and the
 * plates can carry that bed up to stand as a salt plain.
 */
function dryClosedWater(map: PhysicalField, span: number) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 2 || map.LakeOverflow.get(i) > 0) continue;
    if (MapScale.metres(map.Rainfall.get(i), "mm") >= map.scale.length(dryBasin)) continue;
    const salt = Math.min(units(map.scale.length(saltPerSpan) * span), map.WaterDepths.get(i));
    if (salt <= 0) continue;
    constructRock(map, i, salt, rockCatalogue.saltbed, "burial", "sea");
  }
}
/** Buried sediment hardens from the material retained when it was deposited. */
export function lithification(map: PhysicalField, span: number) {
  dryClosedWater(map, span);
  const from = units(map.scale.length(lithifyFrom)),
    hardened = 1 - stillLoosePerSpan ** span;
  for (let i = 0; i < map.mesh.count; i++) lithifyBuried(map, i, from, hardened, "burial");
}
/** Rock this far down turns to its next form under the fullest heat, and deeper under less. */
function bake(map: PhysicalField, i: number, heat: number) {
  const reaches = units(map.scale.length(bakingDepth)) / heat;
  for (const facet of ["land", "cut"] as const) {
    if (facetShare(map, i, facet) <= 0) continue;
    let above = columnThickness(map, i, coverColumn(facet));
    for (let layer = 0; layer <= deepestLayer(map, i, facet); layer++) {
      if (above >= reaches) {
        const material = heatedMaterial(readLayer(map, i, layer, facet), map.CompletedEpochCount);
        setLayer(map, i, layer, material.kind, material.depth, material, facet);
      }
      above += layerDepth(map, i, layer, facet);
    }
  }
  projectGround(map, i);
}
/**
 * Burial and heat: rock deep under a range or an old suture turns to its next form, whatever its
 * neighbours do, because grade is how deep and how hot it has been. Nothing at the surface bakes; it
 * shows only once erosion and thrusts have brought it up, so grade comes to the surface in zones
 * along the belt, highest where the most has been stripped.
 */
export function metamorphism(map: PhysicalField, context: PhysicalContext) {
  const heat = ask(map, "heat", context);
  for (let i = 0; i < map.mesh.count; i++) if (heat.get(i) > 0) bake(map, i, heat.get(i));
}
/** The crust's own heat: what a belt has built on it, or an old suture beneath it. */
respond({
  key: "heat",
  by: "burial",
  reads: ["OrogenicConstruction", "CrustSutureStrength"],
  base: (map, i) =>
    Math.max(
      Math.min(
        fullHeat,
        map.OrogenicConstruction.get(i) / units(map.scale.length(bakingConstruction))
      ),
      (map.CrustSutureStrength.get(i) / 1000) * sutureHeat
    ),
});
