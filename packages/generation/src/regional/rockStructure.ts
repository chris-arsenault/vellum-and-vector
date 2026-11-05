import { fractalNoise } from "../canonry/noise";
import { units } from "../canonry/math";
import { releaseWorking } from "../canonry/physicalNumerics";
import { rockColumnFields, stripRock } from "../rock/rockColumn";
import { materialBands } from "./material";
import { clamp, type RegionalState } from "./state";

/**
 * A region's rock is the world's column, resolved. The coarse map holds one column per cell, so the
 * first thing to do is let those columns interfinger across their edges; then the belt's folds lift
 * what is in the column: axes that stand up have lost their upper layers, so deep rock crops out
 * along them, and troughs keep what lay on top. Nothing is drawn: each outcrop band is a real layer
 * exposed by the structure, and the cuts of later rounds strip the same column.
 */

/** How far columns interfinger, as a share of the parent's cell. */
const interfingerShare = 0.45;
/** How much rock a fold axis at full coherence has lost, in metres. */
const foldRelief = 1400;

function interfinger(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    seed = state.regional.input.seed,
    wavelength = state.regional.parentSpan,
    reach = wavelength * interfingerShare,
    [west, south, east, north] = mesh.bounds,
    names = [...rockColumnFields, "RockKindCodes", "RockResistance"] as const,
    before = names.map((name) => map.coverage.copyBand(map[name]));
  for (let i = 0; i < mesh.count; i++) {
    const x = mesh.x(i),
      y = mesh.y(i),
      px = x + mesh.origin[0],
      py = y + mesh.origin[1],
      source = mesh.cellAt(
        clamp(x + fractalNoise(px, py, seed ^ 0x4c1a, wavelength, 3) * reach, west, east),
        clamp(y + fractalNoise(px, py, seed ^ 0x2be7, wavelength, 3) * reach, south, north)
      );
    if (source >= 0 && source !== i)
      names.forEach((name, n) => map[name].set(i, before[n].get(source)));
  }
  releaseWorking(map, ...before);
}
function exposeFolds(state: RegionalState) {
  const map = state.physical.map,
    bands = materialBands(state);
  for (let i = 0; i < map.mesh.count; i++)
    if (bands[i] > 0) stripRock(map, i, units(foldRelief * bands[i]));
}
/** The column as the region starts from it, once its character is known. */
export function foldTheColumn(state: RegionalState) {
  interfinger(state);
  exposeFolds(state);
}
/** What the rounds have cut uncovers rock: only what this round cut beyond the last. */
export function uncoverCuts(state: RegionalState) {
  const map = state.physical.map,
    uncovered = (state.regional.uncovered ??= new Float64Array(map.mesh.count));
  for (let i = 0; i < uncovered.length; i++) {
    const cut = map.CumulativeFluvialErosion.get(i);
    if (cut <= uncovered[i]) continue;
    stripRock(map, i, cut - uncovered[i]);
    uncovered[i] = cut;
  }
}
