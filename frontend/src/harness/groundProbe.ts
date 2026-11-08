import { groundOf } from "../../../packages/generation/src/rock/ground";
import { columns } from "../../../packages/generation/src/rock/rockLayerFields";
import {
  groundPlacementFields,
  heldLayers,
  heldPlacement,
  heldProperty,
  watchGroundTransfers,
  type HeldRock,
} from "../../../packages/generation/src/rock/groundTransport";
import { capturedAnswersAt } from "../../../packages/generation/src/coupling/answers";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import type { NativeProcessObserver } from "../../../packages/generation/src/world/physicalSteps";

/** Fixed selected cells only; receiving destinations do not silently expand the watch set. */
export function groundProbeCells(text: string) {
  if (!text.trim()) return [];
  const cells = text.split(",").map((value) => Number(value.trim()));
  if (
    text.split(",").some((value) => !value.trim()) ||
    cells.some((cell) => !Number.isInteger(cell) || cell < 0)
  )
    throw new Error("HARNESS_GROUND_CELLS must contain nonnegative integer cell indices.");
  return [...new Set(cells)];
}
function cellGround(map: PhysicalField, cell: number) {
  const ground = groundOf(map),
    neighbors: number[] = [];
  for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
    const neighbor = map.mesh.neighbor(cell, edge);
    if (neighbor >= 0) neighbors.push(neighbor);
  }
  return {
    cell,
    at: [map.mesh.x(cell) + map.mesh.origin[0], map.mesh.y(cell) + map.mesh.origin[1]],
    elevation: ground.view("Elevation").get(cell),
    land: ground.section(cell, "land"),
    cut: ground.section(cell, "cut"),
    faces: neighbors.map((neighbor) => ({ neighbor, exposed: ground.face(cell, neighbor) })),
    runoff: map.Runoff.get(cell),
    flow: map.FlowAccumulation.get(cell),
    fluvialCut: map.CumulativeFluvialErosion.get(cell),
    deposition: map.CumulativeDeposition.get(cell),
    capturedAnswers: capturedAnswersAt(map, cell),
  };
}
function donorGround(held: HeldRock, source: number) {
  return {
    source,
    placement: Object.fromEntries(
      groundPlacementFields.map((field) => [field, heldPlacement(held, field, source)])
    ),
    cutShare: heldProperty(held, "GroundCutShare", source),
    cutDepth: heldProperty(held, "GroundCutDepth", source),
    columns: Object.fromEntries(
      columns.map((column) => [
        column,
        heldLayers(held, source, column).filter(
          (layer, slot) =>
            layer.depth > 0 || (slot === 0 && (column === "land" || column === "cut"))
        ),
      ])
    ),
  };
}
/** Material observations at real process boundaries, plus owner-confirmed transfer relationships. */
export function groundProbe(cells: readonly number[]) {
  const selected = new Set(cells),
    samples: object[] = [];
  let latestBoundary: object | undefined;
  const stop = watchGroundTransfers(selected, (event, map, held) => {
    // Follow arrivals and later wear at the selected sites, not every destination of their donors.
    if (!selected.has(event.target)) return;
    samples.push({
      kind: "transfer",
      ...event,
      completedEpochs: map.CompletedEpochCount,
      // A nested native step may be the last boundary; this is context, not operator attribution.
      lastProcessBoundary: latestBoundary,
      donor: donorGround(held, event.source),
      destination: cellGround(map, event.target),
    });
  });
  const observe: NativeProcessObserver = (step, event, map, context) => {
    latestBoundary = { step, epoch: context.EpochIndex, ...event };
    for (const cell of cells) {
      if (cell >= map.mesh.count)
        throw new Error(`Ground probe cell ${cell} exceeds this map's ${map.mesh.count} cells.`);
      samples.push({ kind: "process", ...latestBoundary, ground: cellGround(map, cell) });
    }
  };
  return { observe, stop, read: () => samples };
}
