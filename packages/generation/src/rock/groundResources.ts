import type { ChannelBinding } from "../world/atlasChannels";
import type { ReadBand } from "@atlas/domain";
import { units } from "../world/math";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import { rockCatalogue, rockKindOfCode } from "./rockCatalogue";
import { setLayer } from "./rockColumn";
import { projectGround } from "./groundShares";
import { groundStorage } from "./groundStorage";
import type { GroundOwnedName } from "./groundStorage";
import {
  allColumnFields,
  allColumnIntegerFields,
  columnFields,
  columns,
  materialProperties,
  type Column,
  type MaterialProperty,
  type MaterialState,
} from "./rockLayerFields";
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
export const groundResourceBindings: ChannelBinding[] = [
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
    epoch = /(?:FormedMin|FormedMax|Altered)\d*$/.test(native);
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
    scale: depth ? 1 / 1024 : 1,
    ...resourceBounds(native),
    global: native.startsWith("SeaLoad"),
    areaDensity: native.endsWith("Volume"),
    discrete: true,
  };
});
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

/** Missing legacy history stays unknown (-1), rather than being assigned to the current epoch. */
function missingProperty(
  map: PhysicalField,
  cell: number,
  kind: number,
  property: MaterialProperty,
  surface: boolean,
  imported: ReadonlySet<PhysicalBufferName>
) {
  if (property === "secondaryKind") return kind;
  if (property === "strength")
    return surface && imported.has("RockResistance")
      ? map.RockResistance.get(cell)
      : rockKindOfCode(kind).resistance;
  if (property === "formedMin" || property === "formedMax" || property === "altered") return -1;
  return 0;
}
function importedDepth(
  map: PhysicalField,
  imported: ReadonlySet<PhysicalBufferName>,
  name: PhysicalBufferName,
  cell: number,
  fallback: number
) {
  return imported.has(name) ? map[name].get(cell) : fallback;
}
function initializeColumn(
  map: PhysicalField,
  cell: number,
  column: Column,
  imported: ReadonlySet<PhysicalBufferName>,
  legacyCover: number
) {
  const fields = columnFields[column];
  for (let slot = 0; slot < fields.kind.length; slot++) {
    const surface = column === "land" && slot === 0,
      loose = column === "loose" && slot === 0,
      kind = imported.has(fields.kind[slot])
        ? map[fields.kind[slot]].get(cell)
        : surface
          ? map.RockKindCodes.get(cell)
          : rockCatalogue.alluvium.code,
      recordedDepth = importedDepth(
        map,
        imported,
        fields.depth[slot],
        cell,
        loose ? legacyCover : 0
      ),
      // One native unit marks a present, unbounded basement; it is not a known thickness.
      depth = surface ? Math.max(1, recordedDepth) : recordedDepth;
    if (depth <= 0 && !surface) continue;
    const state = Object.fromEntries(
      materialProperties
        .filter((property) => property !== "kind" && property !== "depth")
        .map((property) => [
          property,
          imported.has(fields[property][slot])
            ? map[fields[property][slot]].get(cell)
            : missingProperty(map, cell, kind, property, surface, imported),
        ])
    ) as MaterialState;
    setLayer(map, cell, slot, kind, depth, state, column);
  }
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
function initializeImportedPlacement(
  map: PhysicalField,
  cell: number,
  imported: ReadonlySet<PhysicalBufferName>
) {
  const ground = groundStorage(map);
  if (!imported.has("BedrockElevation"))
    ground.BedrockElevation.set(cell, map.Elevation.get(cell) - map.SedimentThickness.get(cell));
  if (!imported.has("CrustSupportElevation"))
    ground.CrustSupportElevation.set(cell, map.Elevation.get(cell));
  if (!imported.has("CrustContinentalFraction"))
    ground.CrustContinentalFraction.set(
      cell,
      map.Elevation.get(cell) >= map.BaseSeaLevel ? 1000 : 0
    );
  if (map.CrustThickness.get(cell) <= 0)
    ground.CrustThickness.set(cell, units(1000 + 3 * map.CrustContinentalFraction.get(cell)));
  map.CrustTypeCodes.set(cell, map.CrustContinentalFraction.get(cell) >= 500 ? 2 : 1);
}
/** Import has finished: ground columns now own the projections, including on legacy input. */
export function finishGroundImport(map: PhysicalField, imported: ReadonlySet<PhysicalBufferName>) {
  const complete = allColumnFields.every((name) => imported.has(name));
  for (let cell = 0; cell < map.mesh.count; cell++) {
    initializeImportedPlacement(map, cell, imported);
    if (!complete) {
      const legacyCover = map.SedimentThickness.get(cell);
      for (const column of columns) initializeColumn(map, cell, column, imported, legacyCover);
    }
    projectGround(map, cell);
    const area = map.mesh.area(cell);
    groundStorage(map).SedimentSupply.set(
      cell,
      area > 0 ? (map.GroundLoadVolume.get(cell) * 1024) / area : 0
    );
  }
  if (!imported.has("Geothermal")) map.Geothermal.fill(0);
}
