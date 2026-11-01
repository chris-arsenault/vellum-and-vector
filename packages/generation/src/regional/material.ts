import { hashUnit } from "../canonry/noise";
import { grainAt } from "./character";
import { clamp, spacing, type RegionalState } from "./state";

/** Erodibility contrast between the weakest and most resistant band, as an exponent at full coherence. */
const bandContrast = 0.9;
/** Hard rock resists; open fractures weaken. Exponents on the captured ratios. */
const rockWeight = 0.6,
  fractureWeight = 0.5;
/** Band width along the grain, as a share of the parent span: strata are continuous along strike. */
const bandLength = 1.5;
/** Added resistance of fully warded ground (the lore's stable rivers and coasts). */
const wardResistance = 0.5;

/**
 * Material organization: the strata and fold limbs of a belt as bands that are continuous
 * along the structural grain and vary across it. A white field is integrated along the
 * grain's streamlines, so the bands follow the grain wherever it turns, pinch out where the
 * streamlines diverge, and vanish where the country has no grain. Values in about -1..1.
 */
export function materialBands(state: RegionalState): Float64Array {
  const g = state.surface,
    n = g.active.length,
    character = state.character!,
    [dx, dy] = spacing(g),
    steps = Math.max(3, Math.round((state.parentSpan * bandLength) / Math.min(dx, dy))),
    white = new Float64Array(n),
    bands = new Float64Array(n);
  for (let i = 0; i < n; i++)
    white[i] = hashUnit(state.input.seed ^ 0x1c3d, i % g.width, Math.floor(i / g.width)) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const { coherence } = grainAt(character, i);
    if (coherence < 0.05) continue;
    const forward = integrateAlong(state, white, i, 1, steps),
      backward = integrateAlong(state, white, i, -1, steps),
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
  steps: number
) {
  const g = state.surface,
    character = state.character!,
    [dx, dy] = spacing(g),
    cell = Math.min(dx, dy),
    { theta } = grainAt(character, start);
  let x = start % g.width,
    y = Math.floor(start / g.width),
    ux = Math.cos(theta) * sign,
    uy = Math.sin(theta) * sign,
    sum = 0,
    weight = 0;
  for (let s = 1; s <= steps; s++) {
    x += ux * (cell / dx);
    y += uy * (cell / dy);
    const xi = Math.round(x),
      yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= g.width || yi >= g.height) break;
    const j = yi * g.width + xi,
      here = grainAt(character, j);
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
 * Resistance of the material at a cell to being cut: the shared medium rock, water and Fire
 * encounter. Resistant bands, hard rock and intact ground resist; weak bands and open
 * fractures yield. Magic's rock and fracture contributions are read from the present
 * channels, so a round's hardening or cracking changes where the next round cuts.
 */
export function materialResistance(state: RegionalState, bands: Float64Array, i: number) {
  const c = state.surface.channels,
    rock = c.rock?.get(i) ?? 1,
    fracture = c.fracture?.get(i) ?? 0,
    // Hallowed ground keeps its beds and banks: inside a ward the country resists cutting.
    ward = clamp((c["magic:hallowed:intensity"]?.get(i) ?? 0) / 1000);
  return clamp(
    Math.exp(bandContrast * bands[i] + rockWeight * (rock - 1) - fractureWeight * clamp(fracture)) *
      (1 + wardResistance * ward),
    0.35,
    3.5
  );
}
