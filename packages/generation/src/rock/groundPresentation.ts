import type { SurfaceCategory } from "@atlas/domain";
import { rockCatalogue, rockCodeCount, type RockKindId } from "./rockCatalogue";
import type { GroundFacet, GroundSectionLayer } from "./groundShares";
import type { PhysicalField } from "../world/field";
import { groundOf } from "./ground";
import type { GroundQuery } from "./groundQuery";
import type { MaterialLayer } from "./rockColumn";

type Colour = readonly [number, number, number];
type Surface = Pick<GroundSectionLayer, "kind" | "secondaryKind" | "secondaryShare" | "share">;

/** Present material colours; they do not indicate an active magical field or historical origin. */
export const materialColours: Readonly<Record<RockKindId, Colour>> = {
  strata: [183, 169, 133],
  shale: [132, 137, 145],
  sandstone: [218, 176, 105],
  limestone: [201, 207, 166],
  saltbed: [241, 226, 214],
  slate: [107, 116, 135],
  schist: [144, 151, 137],
  marble: [225, 222, 203],
  quartzite: [218, 189, 182],
  gneiss: [177, 146, 146],
  granite: [197, 145, 131],
  basalt: [89, 91, 99],
  tuff: [192, 171, 146],
  impactite: [147, 123, 105],
  veinrock: [176, 80, 54],
  sinter: [208, 140, 77],
  corefall: [103, 67, 60],
  rimerot: [139, 180, 201],
  auroraCrystal: [87, 193, 200],
  crushstone: [112, 123, 179],
  rootstone: [94, 145, 86],
  tufa: [194, 205, 116],
  saltGlass: [212, 148, 191],
  keptStone: [233, 205, 108],
  tornstone: [154, 105, 183],
  alluvium: [161, 135, 103],
  soil: [113, 94, 66],
  glacierIce: [218, 240, 247],
};
export const surfaceWaterCode = rockCodeCount;
export const surfaceMaterialCategories: SurfaceCategory[] = [
  ...Object.values(rockCatalogue).map((kind) => ({
    code: kind.code,
    name: kind.name,
    color: `#${materialColours[kind.id].map((value) => value.toString(16).padStart(2, "0")).join("")}`,
    bathymetric: false,
    tint: 1,
  })),
  { code: surfaceWaterCode, name: "Water", color: "#34566b", bathymetric: false, tint: 1 },
];

/** Categorical display selects the largest exposed constituent, including the soil skin's share. */
export function exposedMaterialCode(
  sections: readonly (readonly Surface[])[],
  soilShare = 0,
  water = false,
  ice = false
) {
  if (ice) return rockCatalogue.glacierIce.code;
  if (water) return surfaceWaterCode;
  const shares = new Float64Array(rockCodeCount);
  shares[rockCatalogue.soil.code] = soilShare;
  for (const section of sections) {
    const surface = section[0];
    if (!surface) continue;
    const share = surface.share * (1 - soilShare);
    shares[surface.kind] += share * (1 - surface.secondaryShare);
    shares[surface.secondaryKind] += share * surface.secondaryShare;
  }
  let dominant = rockCatalogue.strata.code;
  for (let code = 0; code < shares.length; code++)
    if (shares[code] > shares[dominant]) dominant = code;
  return dominant;
}

/** A derived display projection; the retained ground remains the only material authority. */
const exposedMaterial: GroundQuery<MaterialLayer | undefined> = {
  start: undefined,
  loose: (_, layer) => layer.material,
  rock: (cover, layer) => cover ?? layer.material,
};
export function surfaceMaterialCode(map: PhysicalField, cell: number) {
  const ground = groundOf(map),
    surface = (facet: GroundFacet) => {
      const material = ground.fold(cell, exposedMaterial, facet);
      return material ? [{ ...material, share: ground.share(cell, facet) }] : [];
    };
  return exposedMaterialCode(
    [surface("land"), surface("cut")],
    ground.soilShare(cell),
    map.WaterKindCodes.get(cell) !== 0,
    map.IceThickness.get(cell) > 0
  );
}
