import type { ChannelBinding } from "../world/atlasChannels";
import { MapScale, requireThat, type ReadBand } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { projectGround } from "./groundShares";
import { groundStorage } from "./groundStorage";
import type { GroundOwnedName } from "./groundStorage";
import { allColumnFields, allColumnIntegerFields, columnFields, columns } from "./rockLayerFields";
import {
  loadIntegerFields,
  loadScalarFields,
  seaLoadIntegerFields,
  seaLoadScalarFields,
} from "./groundLoad";

const aliases = new Map<string, string>([
  ...columnFields.land.kind.map((name, layer) => [name, `rockLayer${layer}`] as [string, string]),
  ...columnFields.land.depth.map((name, layer) => [name, `rockDepth${layer}`] as [string, string]),
]);
const categories = new Set<string>([
  ...allColumnIntegerFields,
  ...loadIntegerFields,
  ...seaLoadIntegerFields,
]);
const depths = new Set<string>([
  ...columns.flatMap((column) => columnFields[column].depth),
  "GroundCutDepth",
  "GroundCutCover",
]);
/** Native names preserve material metadata; the existing land kind/depth channels retain their names. */
const materialResourceBindings: ChannelBinding[] = [
  ...allColumnFields,
  "GroundCutShare",
  "GroundCutDepth",
  "GroundCutCover",
  ...loadIntegerFields,
  ...loadScalarFields,
  ...seaLoadIntegerFields,
  ...seaLoadScalarFields,
].map((native) => {
  const category = categories.has(native),
    depth = depths.has(native),
    epoch = /(?:FormedMin|FormedMax|Altered|Deposited)\d*$/.test(native);
  return {
    name: aliases.get(native) ?? native,
    native: native as PhysicalBufferName,
    unit: category
      ? "category"
      : depth
        ? "metre"
        : epoch
          ? "epoch"
          : native.endsWith("Volume")
            ? "cubic-metre/square-metre"
            : "ratio",
    scale: depth ? MapScale.metres(1, "native") : 1,
    ...resourceBounds(native),
    global: false,
    areaDensity: native.endsWith("Volume"),
    discrete: true,
  };
});
/** Placement and composition belong to the ground record as much as its material columns. */
export const groundResourceBindings: ChannelBinding[] = [
  ...materialResourceBindings,
  {
    name: "bedrock",
    native: "BedrockElevation",
    unit: "metre",
    scale: MapScale.metres(1, "native"),
    datum: true,
  },
  {
    name: "crustSupport",
    native: "CrustSupportElevation",
    unit: "metre",
    scale: MapScale.metres(1, "native"),
    datum: true,
  },
  {
    name: "crustThickness",
    native: "CrustThickness",
    unit: "metre",
    scale: MapScale.metres(1, "native"),
    minimum: 0,
  },
  {
    name: "rockLoad",
    native: "SurfaceRockLoad",
    unit: "metre",
    scale: MapScale.metres(1, "native"),
  },
  {
    name: "continentalFraction",
    native: "CrustContinentalFraction",
    unit: "ratio",
    scale: 1 / 1000,
    minimum: 0,
  },
];
function resourceBounds(native: string) {
  if (/Share\d*$/.test(native)) return { minimum: 0, maximum: 1 };
  if (depths.has(native) && native !== "GroundCutDepth") return { minimum: 0 };
  if (native.endsWith("Volume")) return { minimum: 0 };
  return {};
}

/** Area represented by a map, excluding its context halo. */
export function groundResourceArea(map: PhysicalField) {
  let area = 0;
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (map.mesh.membership(cell) === 1) area += map.mesh.area(cell);
  return area;
}

/** Copy a complete resource band into its owner during explicit import; no writable alias escapes. */
export function importGroundBand(
  map: PhysicalField,
  name: GroundOwnedName,
  source: ReadBand | ArrayLike<number> | ((cell: number) => number)
) {
  const target = groundStorage(map)[name];
  if (!target) throw new Error(`Ground import cannot write non-ground field ${name}.`);
  const valueAt =
    typeof source === "function"
      ? source
      : "get" in source
        ? (cell: number) => source.get(cell)
        : (cell: number) => source[cell];
  for (let cell = 0; cell < map.mesh.count; cell++) target.set(cell, valueAt(cell));
}
/** Complete current-format material records own the reconstructed projections. */
export function finishGroundImport(map: PhysicalField, imported: ReadonlySet<PhysicalBufferName>) {
  requireThat(
    groundResourceBindings.every(({ native }) => imported.has(native)),
    "ground_import",
    "Ground import requires complete current-format material records."
  );
  for (let cell = 0; cell < map.mesh.count; cell++) {
    map.CrustTypeCodes.set(cell, map.CrustContinentalFraction.get(cell) >= 500 ? 2 : 1);
    projectGround(map, cell);
    const area = map.mesh.area(cell);
    groundStorage(map).SedimentSupply.set(
      cell,
      area > 0 ? MapScale.inUnits(map.GroundLoadVolume.get(cell) / area, "native") : 0
    );
  }
}
