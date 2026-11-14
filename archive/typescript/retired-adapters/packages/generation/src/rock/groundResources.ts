import type { PhysicalChannel } from "../world/atlasChannels";
import { MapScale, requireThat, type ReadBand } from "@atlas/domain";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { projectGround } from "./groundShares";
import { groundStorage } from "./groundStorage";
import type { GroundOwnedName } from "./groundStorage";
import { allColumnFields, allColumnIntegerFields, columnFields, columns } from "@atlas/domain";
import {
  loadIntegerFields,
  loadScalarFields,
  seaLoadIntegerFields,
  seaLoadScalarFields,
} from "@atlas/domain";

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
/** Material resources retain the owner's identifiers, units and complete donor packages. */
const materialNames = [
  ...allColumnFields,
  "GroundCutShare",
  "GroundCutDepth",
  "GroundCutCover",
  ...loadIntegerFields,
  ...loadScalarFields,
  ...seaLoadIntegerFields,
  ...seaLoadScalarFields,
] as const satisfies readonly PhysicalBufferName[];
const materialResourceChannels: PhysicalChannel[] = materialNames.map((name) => {
  const category = categories.has(name),
    volume = name.endsWith("Volume");
  return {
    name,
    unit: materialUnit(name),
    quantity: category ? "category" : volume ? "extensive" : "intensive",
    ...resourceBounds(name),
    discrete: true,
  };
});
function materialUnit(name: string) {
  if (categories.has(name)) return "category";
  if (depths.has(name)) return "native-length";
  if (/(?:FormedMin|FormedMax|Altered|Deposited)\d*$/.test(name)) return "epoch";
  if (name.endsWith("Volume")) return "cubic-metre";
  if (/Strength\d*$/.test(name)) return "rock-strength";
  if (/BedSlope[XY]\d*$/.test(name)) return "gradient";
  return "ratio";
}
/** Placement and composition belong to the ground record as much as its material columns. */
export const groundResourceChannels: PhysicalChannel[] = [
  ...materialResourceChannels,
  {
    name: "BedrockElevation",
    unit: "native-length",
  },
  {
    name: "CrustSupportElevation",
    unit: "native-length",
  },
  {
    name: "CrustThickness",
    unit: "native-length",
    minimum: 0,
  },
  {
    name: "SurfaceRockLoad",
    unit: "native-length",
  },
  {
    name: "CrustContinentalFraction",
    unit: "per-mille",
    minimum: 0,
  },
];
function resourceBounds(native: string) {
  if (/Share\d*$/.test(native)) return { minimum: 0, maximum: 1 };
  if (depths.has(native) && native !== "GroundCutDepth") return { minimum: 0 };
  if (native.endsWith("Volume")) return { minimum: 0 };
  return {};
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
    groundResourceChannels.every(({ name }) => imported.has(name)),
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
