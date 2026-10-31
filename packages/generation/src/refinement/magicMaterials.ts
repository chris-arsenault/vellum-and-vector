import { gridPosition, resolutionCells, type Band, type MagicSystem } from "@atlas/domain";
import { hashUnit } from "../canonry/noise";
import { channel, clamp, type RefinementState } from "./state";

/** Coarse fractional landscapes become coherent deposits, not weak magic in every fine cell. */
const depositWavelengths = 2;
/** Below this fraction the stock remains trace material unless its local density is substantial. */
const traceFootprint = 0.02;

export function magicCoverage(state: RefinementState, id: string, i: number) {
  const c = state.surface.channels,
    total = c[`magic:${id}:coverage`];
  if (total) return clamp(total.get(i));
  let share = 0;
  for (const [name, values] of Object.entries(c))
    if (name.startsWith(`magic:${id}:coverage:`)) share = Math.max(share, values.get(i));
  return clamp(share);
}

/** A compact, jittered geological/landscape patch in world coordinates. No subcell entities. */
export function materialPattern(state: RefinementState, id: string): Band {
  const g = state.surface,
    pattern = g.coverage.scratch("float64", `regional:${id}:deposits`, g.active.length),
    span = g.scope.resolution ?? 1,
    wavelength = Math.max(state.parentSpan * depositWavelengths, span * 4),
    stock = Object.entries(g.channels).filter(([name]) => name.startsWith(`magic:${id}:stock:`)),
    coverage = g.channels[`magic:${id}:coverage`],
    classes = Object.entries(g.channels).filter(([name]) =>
      name.startsWith(`magic:${id}:coverage:`)
    );
  let salt = state.input.seed;
  for (const char of id) salt = Math.imul(salt ^ char.charCodeAt(0), 16777619);
  for (let i = 0; i < pattern.length; i++) {
    const p = gridPosition(g, i),
      x = p.x / wavelength,
      y = p.y / wavelength,
      cx = Math.floor(x),
      cy = Math.floor(y);
    let density = 0;
    for (const [, values] of stock) density = Math.max(density, values.get(i) / g.measures.get(i));
    const share =
        coverage?.get(i) ?? classes.reduce((max, [, values]) => Math.max(max, values.get(i)), 0),
      fraction = clamp(share || density / 1000 || 0.2, traceFootprint, 0.8),
      radius2 = fraction / Math.PI;
    if (Math.sqrt(radius2) * wavelength * 2 < span * resolutionCells) {
      // Keep an unresolved deposit latent when no cell can yet locate its footprint.
      pattern.set(i, 1);
      continue;
    }
    // The compact kernel's mean is a third of its footprint. This is local
    // concentration of context, not an exact inventory constraint against a parent.
    pattern.set(i, (patchWeight(x, y, cx, cy, salt, radius2) * 3) / fraction);
  }
  return pattern;
}

function patchWeight(x: number, y: number, cx: number, cy: number, salt: number, radius2: number) {
  let weight = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const px = cx + dx + 0.2 + hashUnit(salt, cx + dx, cy + dy) * 0.6,
        py = cy + dy + 0.2 + hashUnit(salt ^ 0x751b, cx + dx, cy + dy) * 0.6,
        r2 = ((x - px) ** 2 + (y - py) ** 2) / radius2;
      if (r2 < 1) weight = Math.max(weight, (1 - r2) ** 2);
    }
  return weight;
}

export const presentValue = (state: RefinementState, key: string, i: number) =>
  state.surface.channels[key]?.get(i) ?? 0;

export function stockChannel(state: RefinementState, id: string, key: string) {
  const name = `magic:${id}:stock:${key}`,
    values = channel(state, name, "intensity-square-metre");
  (state.surface.quantities ??= {})[name] = "extensive";
  return values;
}

export function originSource(state: RefinementState, id: string, origin: string) {
  return channel(state, `magic:${id}:origin:${origin}:source`, "relative-intensity");
}

/** Keep each origin distinct while assembling the system's active release. */
export function combineSources(state: RefinementState, system: MagicSystem) {
  const source = channel(state, `magic:${system.id}:source`, "relative-intensity");
  for (const origin of system.origins) {
    const own = originSource(state, system.id, origin.id);
    for (let i = 0; i < source.length; i++) source.set(i, Math.max(source.get(i), own.get(i)));
  }
  return source;
}
