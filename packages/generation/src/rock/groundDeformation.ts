import type { PhysicalField } from "../world/field";
import type { ReadBand } from "@atlas/domain";
import { clamp, elevationLimit, units } from "../world/math";
import { physicalGradients } from "../world/physicalMetric";
import { releaseWorking, workingValues } from "../world/physicalNumerics";
import type { FlowCause } from "../coupling/flows";
import { displaceGround, raiseFromCrust, shiftRock } from "./groundLedger";
import { columnSize, layerDepth, readLayer, setLayer } from "./rockColumn";
import { columnFields, columns } from "./rockLayerFields";
import { facetShare, projectGround } from "./groundShares";
import { materialFact } from "./groundQuery";
import { groundStorage } from "./groundStorage";

/** Successive strains reorient surviving beds; crossing strains can reduce directional coherence. */
export function deformGround(
  map: PhysicalField,
  cell: number,
  x: number,
  y: number,
  coherence: number,
  movement: number
) {
  const length = Math.hypot(x, y);
  if (length <= 0 || movement <= 0) return;
  const ux = x / length,
    uy = y / length,
    gx = (ux * ux - uy * uy) * coherence * 1000,
    gy = 2 * ux * uy * coherence * 1000;
  for (const facet of ["land", "cut"] as const) {
    if (facetShare(map, cell, facet) <= 0) continue;
    for (let slot = 0; slot < columnSize(facet); slot++) {
      if (layerDepth(map, cell, slot, facet) <= 0) continue;
      const layer = readLayer(map, cell, slot, facet),
        thickness = slot === columnSize(facet) - 1 ? map.CrustThickness.get(cell) : layer.depth,
        strain = movement / (movement + Math.max(units(1), thickness)),
        jointing = materialFact(layer, "jointing");
      setLayer(
        map,
        cell,
        slot,
        layer.kind,
        layer.depth,
        {
          ...layer,
          grainX: layer.grainX + (gx - layer.grainX) * strain,
          grainY: layer.grainY + (gy - layer.grainY) * strain,
          damage: clamp(layer.damage + strain * jointing, 0, 1),
          altered: map.CompletedEpochCount,
        },
        facet
      );
    }
  }
  projectGround(map, cell);
}
/** Differential displacement bends the retained contacts, including any cover already deposited. */
function tiltBeds(map: PhysicalField, cell: number, x: number, y: number) {
  if (x === 0 && y === 0) return;
  const stored = groundStorage(map);
  for (const column of columns) {
    const facet = column === "cut" || column === "cutLoose" ? "cut" : "land";
    if (facetShare(map, cell, facet) <= 0) continue;
    const fields = columnFields[column];
    for (let slot = 0; slot < fields.depth.length; slot++) {
      if (stored[fields.depth[slot]].get(cell) <= 0) continue;
      stored[fields.bedSlopeX[slot]].add(cell, x);
      stored[fields.bedSlopeY[slot]].add(cell, y);
      stored[fields.altered[slot]].set(cell, map.CompletedEpochCount);
    }
  }
}
function bendGround(map: PhysicalField, movement: ReadBand) {
  const gradient = physicalGradients(map.mesh, (cell) => movement.get(cell) / 1024, map.coverage);
  for (let cell = 0; cell < map.mesh.count; cell++)
    tiltBeds(map, cell, gradient.x.get(cell), gradient.y.get(cell));
  releaseWorking(map, gradient.x, gradient.y);
}
function applyDisplacement(map: PhysicalField, movement: ReadBand, cause: FlowCause) {
  bendGround(map, movement);
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (movement.get(cell) !== 0) displaceGround(map, cell, movement.get(cell), cause);
}
const admittedMovement = (map: PhysicalField, cell: number, movement: number) =>
  clamp(
    movement,
    units(-elevationLimit) - map.BedrockElevation.get(cell),
    units(elevationLimit) - map.Elevation.get(cell)
  );
/** One deformation moves the package and its bed planes; a translation leaves every dip unchanged. */
export function displaceGroundField(map: PhysicalField, displacement: ReadBand, cause: FlowCause) {
  const movement = workingValues(map, "float64", "ground:displacement", (cell) =>
    admittedMovement(map, cell, displacement.get(cell))
  );
  applyDisplacement(map, movement, cause);
  releaseWorking(map, movement);
}
/** Existing standing rock rides a ramp; the actual rise also bends its inherited contacts. */
export function shiftGroundField(map: PhysicalField, displacement: ReadBand, cause: FlowCause) {
  const movement = workingValues(map, "float64", "ground:rockMovement", (cell) =>
    admittedMovement(map, cell, displacement.get(cell))
  );
  bendGround(map, movement);
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (movement.get(cell) !== 0) shiftRock(map, cell, movement.get(cell), cause);
  releaseWorking(map, movement);
}
/** Crust available beneath each column limits the rise before bedding is deformed. */
export function raiseGroundField(map: PhysicalField, requested: ReadBand, cause: FlowCause) {
  const movement = workingValues(map, "float64", "ground:raised", (cell) =>
    raiseFromCrust(map, cell, Math.max(0, requested.get(cell)), cause)
  );
  bendGround(map, movement);
  releaseWorking(map, movement);
}
/** Support bending changes placement and bedding together, using only the displacement admitted. */
export function supportGroundField(map: PhysicalField, support: ReadBand) {
  const stored = groundStorage(map);
  if (!map.CrustSupportInitialized) {
    stored.CrustSupportElevation.copyFrom(support);
    map.CrustSupportInitialized = true;
    return;
  }
  const movement = workingValues(map, "float64", "ground:supportMovement", (cell) =>
    admittedMovement(map, cell, support.get(cell) - map.CrustSupportElevation.get(cell))
  );
  for (let cell = 0; cell < map.mesh.count; cell++)
    stored.CrustSupportElevation.add(cell, movement.get(cell));
  applyDisplacement(map, movement, "support");
  releaseWorking(map, movement);
}
/** The support process proposes its load-dependent datum; flexure commits the movement. */
export function setSupportTarget(map: PhysicalField, cell: number, elevation: number) {
  groundStorage(map).CrustSupportTarget.set(cell, elevation);
}
