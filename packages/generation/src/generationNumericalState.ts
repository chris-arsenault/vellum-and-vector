import { Band, type Coverage, type GridSurface } from "@atlas/domain";
import type { GenerationState } from "./process";
import type { MagicWorkspace } from "./canonry/magicState";

type Groups = Map<Coverage, Set<Band>>;
function add(groups: Groups, coverage: Coverage, band: Band) {
  let bands = groups.get(coverage);
  if (!bands) groups.set(coverage, (bands = new Set()));
  bands.add(band);
}
function bands(record: object | null | undefined, result: Set<Band>) {
  for (const value of Object.values(record ?? {})) if (value instanceof Band) result.add(value);
}
function record(groups: Groups, coverage: Coverage, values: object | null | undefined) {
  const found = new Set<Band>();
  bands(values, found);
  for (const band of found) add(groups, coverage, band);
}
function gridBands(grid: GridSurface, groups: Groups) {
  add(groups, grid.coverage, grid.active);
  add(groups, grid.coverage, grid.measures);
  record(groups, grid.coverage, grid.channels);
  if (grid.topology) record(groups, grid.topology.coverage, grid.topology);
  for (const overlay of grid.overlays ?? []) gridBands(overlay.grid, groups);
}
/**
 * Enumerate the grid-side bands reachable from the state with the coverage that accounts for
 * each: grids own theirs; society and the projection's sampling tables live in the surface
 * grid's coverage. Handles only, never samples or GIS records.
 */
export function generationGridBands(state: GenerationState): Groups {
  const groups: Groups = new Map(),
    surface = state.surface.coverage,
    work = state.physical;
  gridBands(state.surface, groups);
  for (const grid of Object.values(state.domain.numerical)) gridBands(grid, groups);
  record(groups, surface, state.society);
  record(groups, surface, state.society?.urban);
  for (const path of state.society?.urban?.paths.values() ?? []) record(groups, surface, path);
  if (!work) return groups;
  add(groups, surface, work.samples);
  record(groups, surface, work.interpolation);
  return groups;
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
