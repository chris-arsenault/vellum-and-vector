import type { GenerationState } from "../../process";
import { cellSpan, fieldOf, heldFor, isSea, Landform, landformAt } from "../poiReads";

/**
 * The coast's form, read from the water mask alone: a circle of samples around a cell, as arcs
 * of sea and not-sea. Which arcs the circle shows decides the form, so headland, bay and strait
 * are one reading with three mutually exclusive answers. The circle is drawn in the map's own
 * cells and doubled, so the same test finds a form of any size the map resolves; no size gates
 * it. The smallest circle that shows a form decides. Lakes count as not-sea: they are ground to
 * the coast.
 */
const samples = 24;
/** Circle radii, in the map's cells. */
const radii = [3, 6, 12, 24, 48];
/** The arc that makes a wrap: 14 of 24 samples, 210 degrees. A straight coast shows 180. */
const wrappingArc = 14;
/** A strait's two shores stand at least this many samples apart, 120 degrees, middle to middle. */
const opposedShores = 8;
/** A shore arc of one sample may be a rock; a strait's shores are at least two. */
const leastShore = 2;
/** Ground behind a headland runs on for this many times the circle's radius. */
const neckRadii = 5;

const none = 0;
const codes = { headland: 1, bay: 2, strait: 3 } as const;
export type ShoreForm = keyof typeof codes;

interface Arc {
  sea: boolean;
  start: number;
  length: number;
}
interface Reading {
  code: number;
  wrap: number;
}
const noForm: Reading = { code: none, wrap: 0 };

/** Whether each sample on a circle is sea, or null when the circle leaves the chart. */
function circleAround(state: GenerationState, cell: number, radius: number) {
  const mesh = fieldOf(state).mesh,
    [, south, , north] = mesh.bounds,
    ring = new Array<boolean>(samples);
  for (let k = 0; k < samples; k++) {
    const angle = (k * 2 * Math.PI) / samples,
      x = mesh.x(cell) + radius * Math.cos(angle),
      y = mesh.y(cell) + radius * Math.sin(angle);
    if (y < south || y > north || (!mesh.periodic && beyondEastWest(state, x))) return null;
    const at = mesh.cellAt(x, y);
    if (at < 0) return null;
    ring[k] = isSea(state, at);
  }
  return ring;
}
function beyondEastWest(state: GenerationState, x: number) {
  const [west, , east] = fieldOf(state).mesh.bounds;
  return x < west || x > east;
}

/** The circle's arcs, or none when it is all one thing. */
function arcsOf(ring: readonly boolean[]): Arc[] {
  const first = ring.findIndex((sea, k) => sea !== ring[(k + samples - 1) % samples]);
  if (first < 0) return [];
  const arcs: Arc[] = [];
  for (let k = 0; k < samples; k++) {
    const at = (first + k) % samples,
      last = arcs[arcs.length - 1];
    if (last && last.sea === ring[at]) last.length++;
    else arcs.push({ sea: ring[at], start: at, length: 1 });
  }
  return arcs;
}
const longest = (arcs: readonly Arc[], sea: boolean) =>
  arcs.filter((arc) => arc.sea === sea).reduce((most, arc) => Math.max(most, arc.length), 0);
const middle = (arc: Arc) => arc.start + arc.length / 2;

/** Whether sea, or ground, runs unbroken from a cell along a bearing for `reach` metres. */
function runsAlong(
  state: GenerationState,
  cell: number,
  sample: number,
  reach: number,
  sea: boolean
) {
  const mesh = fieldOf(state).mesh,
    angle = (sample * 2 * Math.PI) / samples,
    span = cellSpan(state);
  for (let d = span; d < reach; d += span) {
    const next = mesh.cellAt(
      mesh.x(cell) + d * Math.cos(angle),
      mesh.y(cell) + d * Math.sin(angle)
    );
    if (next < 0 || isSea(state, next) !== sea) return false;
  }
  return true;
}
/** The circle's samples that are not sea. */
const groundOn = (arcs: readonly Arc[]) =>
  arcs.filter((arc) => !arc.sea).reduce((sum, arc) => sum + arc.length, 0);

/**
 * Two shores facing across the water, narrower than half the circle, with the water open
 * straight from the cell through at least two gaps. Water seen beyond a thin cape is not a gap:
 * the cape stands in the way.
 */
function facingShores(state: GenerationState, cell: number, arcs: readonly Arc[], radius: number) {
  const shores = arcs
    .filter((arc) => !arc.sea && arc.length >= leastShore)
    .sort((a, b) => b.length - a.length);
  if (shores.length < 2 || groundOn(arcs) * 2 < samples) return false;
  const apart = Math.abs(middle(shores[0]) - middle(shores[1])) % samples;
  if (Math.min(apart, samples - apart) < opposedShores) return false;
  const gaps = arcs.filter((arc) => arc.sea && runsAlong(state, cell, middle(arc), radius, true));
  return gaps.length >= 2;
}
function seaForm(state: GenerationState, cell: number, arcs: readonly Arc[], radius: number) {
  if (facingShores(state, cell, arcs, radius))
    return { code: codes.strait, wrap: groundOn(arcs) / samples };
  const shore = longest(arcs, false);
  return shore >= wrappingArc ? { code: codes.bay, wrap: shore / samples } : noForm;
}

/**
 * Sea wrapped around ground that carries on behind the cell for several circles' breadth: the
 * end of something larger. The rim of a round island also shows the wrap, but its ground runs
 * out across the island.
 */
function landForm(state: GenerationState, cell: number, arcs: readonly Arc[], radius: number) {
  const open = longest(arcs, true);
  if (open < wrappingArc) return noForm;
  const neck = arcs
    .filter((arc) => !arc.sea)
    .reduce((most, arc) => (arc.length > most.length ? arc : most));
  return runsAlong(state, cell, middle(neck), neckRadii * radius, false)
    ? { code: codes.headland, wrap: open / samples }
    : noForm;
}

/** The cell's form on one circle. */
function formOnCircle(state: GenerationState, cell: number, radius: number): Reading {
  const ring = circleAround(state, cell, radius);
  if (!ring) return noForm;
  const arcs = arcsOf(ring);
  if (!arcs.length) return noForm;
  return isSea(state, cell)
    ? seaForm(state, cell, arcs, radius)
    : landForm(state, cell, arcs, radius);
}
/** A form's test cannot apply here: an inlet the ice cut is a fjord, inland ground sees no sea. */
function outOfReach(state: GenerationState, cell: number) {
  return isSea(state, cell)
    ? landformAt(state, cell) === Landform.Fjord
    : fieldOf(state).OceanDistance.get(cell) < 0;
}
function readForm(state: GenerationState, cell: number): Reading {
  if (outOfReach(state, cell)) return noForm;
  const span = cellSpan(state),
    distance = isSea(state, cell) ? 0 : fieldOf(state).OceanDistance.get(cell);
  for (const cells of radii) {
    // A circle short of the nearest sea shows only ground.
    if (cells * span < distance) continue;
    const reading = formOnCircle(state, cell, cells * span);
    if (reading.code !== none) return reading;
  }
  return noForm;
}

const readings = (state: GenerationState) =>
  heldFor(state, "shoreForm", () => {
    const count = fieldOf(state).mesh.count;
    return {
      read: new Uint8Array(count),
      code: new Uint8Array(count),
      wrap: new Float32Array(count),
    };
  });
function formAt(state: GenerationState, cell: number) {
  const table = readings(state);
  if (!table.read[cell]) {
    const { code, wrap } = readForm(state, cell);
    table.read[cell] = 1;
    table.code[cell] = code;
    table.wrap[cell] = wrap;
  }
  return table;
}
/** Whether a cell shows this form of coast. */
export const showsForm = (form: ShoreForm) => (state: GenerationState, cell: number) =>
  formAt(state, cell).code[cell] === codes[form];
/**
 * How strongly a cell shows its form, in [0, 1]: the share of the circle the sea wraps a
 * headland, the shore wraps a bay, or the shores take from a strait. Nothing where no form shows.
 */
export const wrapOf = (state: GenerationState, cell: number) => formAt(state, cell).wrap[cell];
