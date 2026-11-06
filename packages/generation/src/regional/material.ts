import { hashUnit } from "../canonry/noise";
import { groundOf } from "../rock/ground";
import { grainAt } from "./character";
import { distance, regionalSpan } from "./lattice";
import { clamp, type RegionalState } from "./state";

/** Band width along the grain, as a share of the parent span: strata are continuous along strike. */
const bandLength = 1.5;
/** Added resistance of a cone's lava apron at the cone, fading to its base radius (plan: cone extension). */
const apronHardness = 0.8;

/** How many folds one of the parent's thrust sheets resolves into, and how much tilt makes a full one. */
const foldsPerSheet = 3,
  fullDip = 800;
/**
 * The fold at a place in one of the parent's thrust sheets: axes repeat across the sheet and run
 * along it, standing as high as the sheet has tilted. Values in about -1..1.
 */
export const sheetFold = (across: number, dip: number) =>
  Math.sin(2 * Math.PI * foldsPerSheet * across) * clamp(dip / fullDip, 0.2, 1);
/**
 * Fold structure: the axes and limbs of a belt as bands that are continuous along the structural
 * grain and vary across it. Where the world thrust this ground they are the parent's own sheets.
 * Elsewhere a white field is integrated along the grain's streamlines, so the bands follow the grain
 * wherever it turns, pinch out where the streamlines diverge, and vanish where the country has no
 * grain. Values in about -1..1.
 */
export function materialBands(state: RegionalState): Float64Array {
  return (state.regional.structure ??= foldStructure(state));
}
function foldStructure(state: RegionalState): Float64Array {
  const map = state.physical.map,
    mesh = map.mesh,
    n = mesh.count,
    character = state.regional.character!,
    span = regionalSpan(state),
    steps = Math.max(3, Math.round((state.regional.parentSpan * bandLength) / span)),
    white = new Float64Array(n),
    bands = new Float64Array(n);
  for (let i = 0; i < n; i++)
    white[i] = hashUnit(state.regional.input.seed ^ 0x1c3d, mesh.identity(i), 0) * 2 - 1;
  for (let i = 0; i < n; i++) {
    if (map.ThrustSheetIndex.get(i) > 0) {
      bands[i] = sheetFold(map.ThrustAcross.get(i) / 1000, map.ThrustDip.get(i));
      continue;
    }
    const { coherence } = grainAt(character, i);
    if (coherence < 0.05) continue;
    const forward = integrateAlong(state, white, i, 1, steps, span),
      backward = integrateAlong(state, white, i, -1, steps, span),
      sum = white[i] + forward.sum + backward.sum,
      weight = 1 + forward.weight + backward.weight;
    // The integrated value shrinks with the band length; rescale to the white field's spread.
    bands[i] = clamp((sum / weight) * Math.sqrt(weight) * 0.8, -1.5, 1.5) * coherence;
  }
  return bands;
}

/** Walk the grain's streamline one way from a cell, summing the white field with fading weight. */
function integrateAlong(
  state: RegionalState,
  white: Float64Array,
  start: number,
  sign: number,
  steps: number,
  span: number
) {
  const mesh = state.physical.map.mesh,
    character = state.regional.character!,
    { theta } = grainAt(character, start);
  let x = mesh.x(start),
    y = mesh.y(start),
    ux = Math.cos(theta) * sign,
    uy = Math.sin(theta) * sign,
    sum = 0,
    weight = 0,
    last = start;
  for (let s = 1; s <= steps; s++) {
    x += ux * span;
    y += uy * span;
    const j = mesh.cellAt(x, y);
    if (j < 0) break;
    if (j === last) continue;
    last = j;
    const here = grainAt(character, j);
    if (here.coherence < 0.05) break;
    // Keep walking the same way along the axis where it turns.
    const flip = Math.cos(here.theta) * ux + Math.sin(here.theta) * uy < 0 ? -1 : 1;
    ux = Math.cos(here.theta) * flip;
    uy = Math.sin(here.theta) * flip;
    const w = 1 - s / (steps + 1);
    sum += white[j] * w;
    weight += w;
  }
  return { sum, weight };
}

/**
 * Resistance of the material at a cell to being cut: the ground as the world reads it, stiffened by
 * a cone's lava apron, which only a region's character knows. Magic's rock and fracture
 * contributions are read from the present bands, so a round's hardening or cracking changes where
 * the next round cuts.
 */
export const materialResistance = (state: RegionalState, i: number) =>
  groundOf(state.physical.map).material(i, 1 + apronHardness * apron(state, i));
/** How far inside a cone's hard apron the cell lies: 1 at the cone, 0 at and beyond its base. */
function apron(state: RegionalState, i: number) {
  const mesh = state.physical.map.mesh;
  let inside = 0;
  for (const cone of state.regional.character?.cones ?? [])
    inside = Math.max(inside, 1 - distance(mesh, cone.cell, i) / cone.radius);
  return clamp(inside);
}
