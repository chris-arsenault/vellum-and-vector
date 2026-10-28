import { Band, isNumericalVector, type GridSurface, type NumericalVector } from "@atlas/domain";
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
  columns(work.map.mesh.topology, result);
  columns(work.interpolation, result);
  return result;
}
function bands(record: object | null | undefined, result: Set<Band>) {
  for (const value of Object.values(record ?? {})) if (value instanceof Band) result.add(value);
}
/** Enumerate the physical coverage's bands reachable from the state. */
export function generationBands(state: GenerationState) {
  const result = new Set<Band>(),
    work = state.physical;
  if (!work) return result;
  bands(work.map, result);
  bands(work.map.transportPlan, result);
  for (const fixed of work.fixed) result.add(fixed.values);
  if (work.magic) magicBands(work.magic, result);
  return result;
}
function magicBands(magic: MagicWorkspace, result: Set<Band>) {
  bands(magic, result);
  bands(magic.confluences, result);
  for (const field of magic.fields) {
    bands(field, result);
    bands(field.originSources, result);
    bands(field.stocks, result);
    bands(field.features, result);
    bands(field.coverage, result);
  }
  for (const meeting of Object.values(magic.confluences.states)) bands(meeting, result);
}
