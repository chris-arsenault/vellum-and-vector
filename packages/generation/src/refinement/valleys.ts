import { channel, clamp, distance, spacing, type RefinementState } from "./state";
import { gradient } from "./terrain";
import { gridPosition } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import { concentratedDrainage, headwaterSamples } from "./channelFormation";

/** A channel's graded slope declines as its contributing area grows. */
const referenceGradient = 0.012;
/** Hillslope adjustment reaches beyond the channel, leaving divides between tributaries. */
const valleyWidthShare = 0.12;
/** Develop a fraction of the available local relief in this new representation. */
const reliefShare = 0.6;
/** Local stream-power development in metres, scaled by area, fall and substrate. */
const incisionStrength = 90;

/** Downstream-first bed profiles and connected valley walls, without physical epochs. */
export function inciseRegionalValleys(state: RefinementState, passes = 1) {
  const g = state.surface,
    { receiver, order, count } = state.drainage!,
    erosion = channel(state, "erosion", "metre"),
    height = g.channels.elevation,
    cuts = g.coverage.scratch("float64", "regional:valley-cuts", height.length),
    widths = g.coverage.scratch("float64", "regional:valley-widths", height.length),
    [dx, dy] = spacing(g),
    gathered = concentratedDrainage(state);
  for (let k = 0; k < count; k++) {
    const i = order.get(k),
      j = receiver.get(i);
    if (j < 0 || !developsValley(state, i, gathered, dx * dy)) continue;
    const reach = distance(g, i, j),
      area = g.channels.catchmentArea.get(i),
      resistance = localResistance(state, i),
      gradedFall = referenceGradient * Math.max(1, area / 1e6) ** -0.35 * resistance * reach,
      available = Math.max(0, height.get(i) - height.get(j) + cuts.get(j) - gradedFall),
      budget = incisionBudget(state, i, resistance) / passes,
      slope = Math.max(0, (height.get(i) - height.get(j)) / reach),
      power = (incisionStrength * (area / 1e6) ** 0.42 * Math.sqrt(slope)) / resistance / passes;
    cuts.set(i, Math.min(budget, available, power));
    widths.set(
      i,
      Math.max(
        Math.max(dx, dy) * 2,
        Math.min(
          state.parentSpan * 0.4,
          state.parentSpan * 0.12 + Math.sqrt(area) * valleyWidthShare
        )
      )
    );
  }
  const envelope = valleyCrossSections(state, cuts, widths);
  for (let k = 0; k < count; k++) {
    const i = order.get(k),
      j = receiver.get(i);
    if (g.channels.water.get(i) !== 0) continue;
    const available = j < 0 ? 0 : Math.max(0, height.get(i) - height.get(j)),
      cut = Math.min(envelope.get(i), available);
    height.add(i, -cut);
    erosion.add(i, cut);
  }
  for (const band of [cuts, widths, envelope, gathered]) g.coverage.release(band);
}

function developsValley(
  state: RefinementState,
  i: number,
  gathered: import("@atlas/domain").Band,
  cellArea: number
) {
  const c = state.surface.channels;
  return (
    c.water.get(i) === 0 &&
    (c.riverOrder.get(i) > 0 ||
      (gathered.get(i) > 0 && c.catchmentArea.get(i) >= headwaterSamples * cellArea))
  );
}

/** Valley walls spread by geographic distance, independent of the raster routing directions. */
function valleyCrossSections(
  state: RefinementState,
  cuts: import("@atlas/domain").Band,
  widths: import("@atlas/domain").Band
) {
  const g = state.surface,
    [dx, dy] = spacing(g),
    envelope = g.coverage.scratch("float64", "regional:valley-cross-sections", g.active.length);
  for (let i = 0; i < cuts.length; i++) {
    if (cuts.get(i) <= 0) continue;
    const x = i % g.width,
      y = Math.floor(i / g.width),
      width = widths.get(i),
      rx = Math.ceil((3 * width) / dx),
      ry = Math.ceil((3 * width) / dy);
    for (let yy = Math.max(0, y - ry); yy <= Math.min(g.height - 1, y + ry); yy++)
      for (let xx = Math.max(0, x - rx); xx <= Math.min(g.width - 1, x + rx); xx++) {
        const j = yy * g.width + xx,
          square = ((xx - x) * dx) ** 2 + ((yy - y) * dy) ** 2,
          cut = cuts.get(i) * Math.exp(-square / (2 * width ** 2));
        envelope.set(j, Math.max(envelope.get(j), cut));
      }
  }
  return envelope;
}

function localResistance(state: RefinementState, i: number) {
  const p = gridPosition(state.surface, i),
    variation = fractalNoise(p.x, p.y, state.input.seed ^ 0x70c4, state.parentSpan / 2, 2);
  return clamp((state.surface.channels.rock?.get(i) ?? 1) * (1 + variation * 0.35), 0.3, 3);
}

function incisionBudget(state: RefinementState, i: number, resistance: number) {
  const { gx, gy } = gradient(state, i, true),
    relief = state.terrain?.relief.get(i) ?? Math.hypot(gx, gy) * state.parentSpan,
    runoff = state.surface.channels.runoff?.get(i) ?? 0,
    supply = Math.max(
      weatheringSupport(state, i),
      clamp(Math.sqrt(Math.max(0, runoff) / 0.3), 0, 1.5)
    );
  return (Math.min(relief * reliefShare, state.parentSpan * 0.12) * supply) / resistance;
}

function weatheringSupport(state: RefinementState, i: number) {
  const c = state.surface.channels,
    bare = 1 - clamp((c.treeCover?.get(i) ?? 0) + (c.grassCover?.get(i) ?? 0));
  return bare * clamp(c.fracture?.get(i) ?? 0);
}
