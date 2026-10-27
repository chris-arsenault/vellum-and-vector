import { isNumericalVector, type GridSurface, type NumericalVector } from "@atlas/domain";
import type { GenerationState } from "./process";
import type { MagicWorkspace } from "./canonry/magicState";

function columns(record: object | null | undefined, result: Set<NumericalVector>) {
  for (const value of Object.values(record ?? {})) if (isNumericalVector(value)) result.add(value);
}
function gridColumns(grid: GridSurface, result: Set<NumericalVector>) {
  result.add(grid.active);
  result.add(grid.measures);
  columns(grid.channels, result);
  columns(grid.topology, result);
  for (const overlay of grid.overlays ?? []) gridColumns(overlay.grid, result);
}
/** Enumerate resource handles, never samples or GIS records. Closures own no replaceable fields. */
export function generationNumericalState(state: GenerationState) {
  const result = new Set<NumericalVector>(),
    work = state.physical;
  gridColumns(state.surface, result);
  for (const grid of Object.values(state.domain.numerical)) gridColumns(grid, result);
  columns(state.society, result);
  columns(state.society?.urban, result);
  for (const path of state.society?.urban?.paths.values() ?? []) columns(path, result);
  if (!work) return result;
  columns(work.map, result);
  columns(work.map.mesh, result);
  columns(work.map.mesh.topology, result);
  columns(work.map.transportPlan, result);
  columns(work.interpolation, result);
  for (const fixed of work.fixed) result.add(fixed.values);
  if (work.magic) magicColumns(work.magic, result);
  return result;
}
function magicColumns(magic: MagicWorkspace, result: Set<NumericalVector>) {
  columns(magic, result);
  columns(magic.confluences, result);
  for (const field of magic.fields) {
    columns(field, result);
    columns(field.originSources, result);
    columns(field.stocks, result);
    columns(field.features, result);
    columns(field.coverage, result);
  }
  for (const meeting of Object.values(magic.confluences.states)) columns(meeting, result);
}
