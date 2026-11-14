import type { Band } from "@atlas/domain";
import { availableCrust } from "../rock/groundLedger";
import { shiftGroundField } from "../rock/groundDeformation";
import {
  moveHeldSheet,
  superposeHeldSheets,
  joinGroundSheet,
  leaveGroundSheet,
} from "../rock/groundTransport";
import type { PhysicalContext } from "./context";
import { adjustCrustColumn } from "../rock/crustTransport";
import { crustForming, type PhysicalField } from "./field";
import { clamp, crustPerRock, units } from "./math";
import { meshPoint } from "./mesh";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { holdRock, releaseHeldRock, type HeldRock } from "./reliefCarry";
import type { BoundaryComponent, OrogenicFrame } from "./orogenicComponents";
import { acrossStrike } from "./orogenicComponents";
import { segmentScale, sheetAt } from "./orogenicShape";

/**
 * A belt is its thrust sheets, and they are rock, not a pattern. A cell joins a sheet when the
 * deformation front first reaches it and keeps its sheet, segment and place in it from then on,
 * carried with the crust. The plates' move has already brought the foreland in against the belt, so
 * each pass of shortening closes the sheets up from the boundary out: the sheet at the boundary
 * holds its place and each one beyond is drawn in under the leading edge of the one behind it,
 * younger rock going beneath older. That edge climbs each time, in the same rock, so a ridge rises
 * where it stands, and the front moves out to take in new sheets ahead of the old. Only the rock
 * above the sheets' floor moves; the crust below stays with its plate.
 */

/** How much of a pass's slip each thrust behind the front keeps, relative to the one before it. */
const slipKept = 0.62;

/** How much of the pass's shortening has slipped on the thrust a given number behind the front. */
function slipShare(behind: number, front: number) {
  const total = (1 - slipKept ** (front + 1)) / (1 - slipKept);
  return slipKept ** behind / total;
}
/**
 * How far the thrust at a sheet's leading edge slips on a pass. A thrust rides no further than the
 * sheet ahead of it in each span of time; shortening past that stays with the crust's roots.
 */
export const thrustSlip = (shortening: number, sheet: number, front: number, most: number) =>
  sheet > front ? 0 : Math.min(most, shortening * slipShare(front - sheet, front));
/** How far a sheet is drawn in on a pass: all the slip on the thrusts between it and the boundary. */
export function drawnIn(shortening: number, sheet: number, front: number, most: number) {
  let distance = 0;
  for (let k = 0; k < sheet; k++) distance += thrustSlip(shortening, k, front, most);
  return distance;
}

/**
 * How far the crust has converged across a belt on this pass: the distance the plates moved, as far
 * as this belt's strain took it up. A world's first forming has no move behind it, so it stands in
 * a distance of its own.
 */
export function shorteningOf(map: PhysicalField, context: PhysicalContext, c: BoundaryComponent) {
  const moved = crustForming(map)
    ? context.Profile.OrogenicInitialShortening
    : map.LastPlateDriftStep;
  return c.strain * moved;
}
const pairKey = (c: BoundaryComponent) => c.pair + 1;
/**
 * Whether a cell's sheets are this belt's: the ground a live belt is shortening now. Ground within
 * a belt's reach but on another pair's sheets is an older belt's, and nothing squeezes it.
 */
export const inBelt = (map: PhysicalField, c: BoundaryComponent, i: number) =>
  map.ThrustPairIds.get(i) === pairKey(c);

/** How far out each belt's sheets reach now, and which is the outermost. */
function currentFronts(map: PhysicalField, components: BoundaryComponent[], frame: OrogenicFrame) {
  const work = new Float64Array(components.length),
    distance = new Float64Array(components.length);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id < 0 || !inBelt(map, components[id], i)) continue;
    work[id] = Math.max(work[id], frame.distance.get(i));
    distance[id] = Math.max(distance[id], frame.reach.get(i));
    components[id].frontSheet = Math.max(
      components[id].frontSheet,
      map.ThrustSheetIndex.get(i) - 1
    );
  }
  return { work, distance };
}
/**
 * A cell joins the sheets its belt's front is making now, numbered on from the last one it made and
 * counted out from where the front stood, so a belt's sheets stay in order whatever its rock does.
 */
function joinSheet(
  map: PhysicalField,
  context: PhysicalContext,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  i: number,
  firstNew: number,
  stood: number
) {
  const { sheet, across, segment } = sheetAt(
      map,
      context,
      c,
      i,
      frame.source.get(i),
      Math.max(0, frame.reach.get(i) - stood)
    ),
    numbered = firstNew + sheet;
  joinGroundSheet(map, i, pairKey(c), numbered + 1, segment, across);
  if (numbered > c.frontSheet) c.frontSheet = numbered;
}
/** A cell the belt reaches for the first time joins a sheet; one it reached before keeps its own. */
export function advanceThrustFronts(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  const p = context.Profile,
    fronts = currentFronts(map, components, frame),
    firstNew = components.map((c) => c.frontSheet + 1);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id < 0 || inBelt(map, components[id], i)) continue;
    const c = components[id],
      source = frame.source.get(i);
    if (source < 0) continue;
    if (c.code !== 1) continue;
    const advance = shorteningOf(map, context, c) * p.OrogenicAccretionRatio,
      reached = frame.distance.get(i) <= fronts.work[id] + advance;
    if (reached) joinSheet(map, context, c, frame, i, firstNew[id], fronts.distance[id]);
  }
}

interface Riding {
  x: number;
  y: number;
  side: number;
}
/** The way out from a belt's boundary at a cell, on the cell's side of it. */
function wayOut(map: PhysicalField, i: number, source: number): Riding | null {
  const tx = map.TectonicTangentX.get(source) / 1000,
    ty = map.TectonicTangentY.get(source) / 1000,
    length = Math.hypot(tx, ty),
    offset = acrossStrike(map, i, source);
  if (length < 0.01 || offset === 0) return null;
  const sign = Math.sign(offset) / length;
  return { x: -ty * sign, y: tx * sign, side: Math.sign(offset) };
}
/** What a pass of shortening asks of a belt's thrusts. */
interface PassSlip {
  shortening(c: BoundaryComponent): number;
  /** The most any one thrust can slip on a pass. */
  most: number;
}
/**
 * Every sheet's move this pass, in whole cells' worth of metres, each settled once however many
 * cells ask. Rock moves whole cells at a time, so a ridge stays one ridge; what a pass's slip does
 * not yet add up to is kept by the sheet for the next pass.
 */
function movesOfPass(map: PhysicalField, slip: PassSlip) {
  const moves = new Map<string, number>();
  return (c: BoundaryComponent, segment: number, sheet: number) => {
    const key = `${c.pair}:${segment}:${sheet}`;
    let move = moves.get(key);
    if (move === undefined) {
      const owed =
        (map.ThrustSlipOwed.get(key) ?? 0) +
        segmentScale(c, segment) * drawnIn(slip.shortening(c), sheet, c.frontSheet, slip.most);
      move = Math.floor(owed / map.mesh.spacing) * map.mesh.spacing;
      map.ThrustSlipOwed.set(key, owed - move);
      moves.set(key, move);
    }
    return move;
  };
}
type Moves = ReturnType<typeof movesOfPass>;
/** Where the rock of a sheet that now lies at this cell came from, if any of it does. */
function originOnSheet(
  map: PhysicalField,
  c: BoundaryComponent,
  source: number,
  i: number,
  sheet: number,
  out: Riding,
  moves: Moves
) {
  const distance = moves(c, map.ThrustSegmentIds.get(i), sheet),
    [x, y] = meshPoint(
      map.mesh,
      map.mesh.x(i) + out.x * distance,
      map.mesh.y(i) + out.y * distance
    ),
    origin = distance > 0 ? map.mesh.cellAt(x, y) : i;
  return origin >= 0 &&
    inBelt(map, c, origin) &&
    map.ThrustSheetIndex.get(origin) === sheet + 1 &&
    (origin === i || Math.sign(acrossStrike(map, origin, source)) === out.side)
    ? origin
    : -1;
}
/** Whether a cell has the next sheet of its belt, or nothing of it, on its way out. */
function isLeadingEdge(
  map: PhysicalField,
  c: BoundaryComponent,
  i: number,
  sheet: number,
  out: Riding
) {
  const [x, y] = meshPoint(
      map.mesh,
      map.mesh.x(i) + out.x * map.mesh.spacing,
      map.mesh.y(i) + out.y * map.mesh.spacing
    ),
    ahead = map.mesh.cellAt(x, y);
  return ahead >= 0 && inBelt(map, c, ahead) && map.ThrustSheetIndex.get(ahead) > sheet + 1;
}
interface MovedRock {
  /** Whose rock lies on top of a cell after the slip, where that is not its own. */
  origin: Band;
  /** The sheet drawn in beneath it, where there is one. */
  under: Band;
  /** How far the edge standing here climbed on this pass, as a share of a whole cell's slip. */
  climb: Band;
  /** A cell whose sheet has been drawn away, with nothing yet in its place. */
  left: Band;
}
/** The two highest sheets whose rock lies at a cell after the slip: the top one and what is under. */
function sheetsHere(
  map: PhysicalField,
  c: BoundaryComponent,
  source: number,
  i: number,
  out: Riding,
  moves: Moves
) {
  let top = -1,
    sheetOnTop = -1;
  for (let sheet = 0; sheet <= c.frontSheet; sheet++) {
    const origin = originOnSheet(map, c, source, i, sheet, out, moves);
    if (origin < 0) continue;
    if (top >= 0) return { top, sheetOnTop, under: origin };
    top = origin;
    sheetOnTop = sheet;
  }
  return { top, sheetOnTop, under: -1 };
}
/** What lies at a cell after the slip, and whether the edge of a sheet climbs here. */
function planCell(
  map: PhysicalField,
  c: BoundaryComponent,
  frame: OrogenicFrame,
  moved: MovedRock,
  moves: Moves,
  slip: PassSlip,
  i: number
) {
  const source = frame.source.get(i),
    out = wayOut(map, i, source);
  if (!out) return;
  const { top, sheetOnTop, under } = sheetsHere(map, c, source, i, out, moves);
  if (top < 0) {
    if (inBelt(map, c, i)) moved.left.set(i, 1);
    return;
  }
  if (top !== i) moved.origin.set(i, top);
  if (under >= 0) moved.under.set(i, under);
  if (!isLeadingEdge(map, c, top, sheetOnTop, out)) return;
  const metres = thrustSlip(slip.shortening(c), sheetOnTop, c.frontSheet, slip.most);
  moved.climb.set(i, metres);
  frame.overlap.set(i, clamp(metres / map.mesh.spacing, 0, 1));
}
/** How high a sheet's leading edge climbs in a pass, in the field's units: its slip up the ramp. */
function rampRise(map: PhysicalField, context: PhysicalContext, i: number, slip: number) {
  const continental = map.CrustContinentalFraction.get(i) / 1000;
  return units(context.Profile.ThrustRampGradient * slip * (0.4 + 0.6 * continental));
}
/** How high this pass would raise a cell's leading edge before available crust is shared. */
function rampWanted(map: PhysicalField, context: PhysicalContext, i: number, climb: number) {
  return rampRise(map, context, i, climb);
}
/** What each belt's ramps would take, and the crust its shortening has piled up, by volume. */
function beltMaterial(map: PhysicalField, context: PhysicalContext, belts: number, climb: Band) {
  const wanted = new Float64Array(belts),
    held = new Float64Array(belts);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id < 0) continue;
    const area = map.mesh.area(i) * MapScale.metres(1, "native");
    held[id] += availableCrust(map, i) * area;
    if (climb.get(i) > 0)
      wanted[id] +=
        rampWanted(map, context, i, climb.get(i)) *
        crustPerRock(map.CrustContinentalFraction.get(i) / 1000) *
        area;
  }
  return { wanted, held };
}
/**
 * Leading edges climb their ramps. A sheet rides out over the foreland on rock from behind it, so what
 * climbs comes from the crust its whole belt has piled up by now, not the crust under the ramp, and a
 * belt with none piled up does not climb. Takes back the climb the slip handed over.
 */
export function climbThrustRamps(
  map: PhysicalField,
  context: PhysicalContext,
  belts: number,
  climb: Band
) {
  const { wanted, held } = beltMaterial(map, context, belts, climb),
    paid = wanted.map((asked, id) => (asked > 0 ? Math.min(1, held[id] / asked) : 0)),
    movement = workingArray(map, "float64", "sheets:rampMovement").fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    const id = map.OrogenicComponentIds.get(i);
    if (id < 0 || paid[id] <= 0) continue;
    const rise = climb.get(i) > 0 ? rampWanted(map, context, i, climb.get(i)) * paid[id] : 0,
      spent = (paid[id] * wanted[id]) / held[id];
    adjustCrustColumn(map, i, map.CrustThickness.get(i) - availableCrust(map, i) * spent);
    if (rise > 0) movement.set(i, rise);
  }
  shiftGroundField(map, movement, "mountains");
  releaseWorking(map, climb, movement);
}
function placeRock(map: PhysicalField, i: number, held: HeldRock, moved: MovedRock) {
  const origin = moved.origin.get(i),
    under = moved.under.get(i),
    top = origin >= 0 ? origin : i;
  if (under < 0) {
    if (origin >= 0) moveHeldSheet(map, held, i, origin);
    return;
  }
  // What was drawn in lies beneath; the sheet above it keeps the surface and the cell.
  superposeHeldSheets(map, held, i, under, top);
}
function movedRock(map: PhysicalField): MovedRock {
  return {
    origin: workingArray(map, "int32", "sheets:origin").fill(-1),
    under: workingArray(map, "int32", "sheets:under").fill(-1),
    climb: workingArray(map, "float64", "sheets:climb").fill(0),
    left: workingArray(map, "uint8", "sheets:left").fill(0),
  };
}
const riding = (map: PhysicalField, components: BoundaryComponent[], i: number) => {
  const id = map.OrogenicComponentIds.get(i);
  return id >= 0 && components[id].code === 1 && components[id].frontSheet >= 0
    ? components[id]
    : null;
};
/** A cell its sheet has left is outside the belt again, until the front takes it in once more. */
function leaveBelt(map: PhysicalField, i: number) {
  leaveGroundSheet(map, i);
}
/** How much of the climb at a thrust's edge the rock just behind it takes. */
const backLimbShare = 0.6;
function sameLimb(map: PhysicalField, frame: OrogenicFrame, i: number, j: number) {
  if (j < 0) return false;
  const source = frame.source.get(i);
  return (
    map.ThrustSheetIndex.get(j) === map.ThrustSheetIndex.get(i) &&
    map.ThrustPairIds.get(j) === map.ThrustPairIds.get(i) &&
    map.OrogenicComponentIds.get(j) === map.OrogenicComponentIds.get(i) &&
    Math.sign(acrossStrike(map, j, source)) === Math.sign(acrossStrike(map, i, source))
  );
}
/**
 * A ramp lifts a fold, not a line of single cells: the rock beside a climbing edge rises with it,
 * back along its own sheet and along the thrust, so a ridge holds together along its length.
 */
function addBackLimbs(map: PhysicalField, frame: OrogenicFrame, moved: MovedRock) {
  const limb = workingArray(map, "float64", "sheets:limb").fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    const climb = moved.climb.get(i),
      sheet = map.ThrustSheetIndex.get(i);
    if (climb <= 0 || !sheet) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (sameLimb(map, frame, i, j)) limb.set(j, Math.max(limb.get(j), climb * backLimbShare));
    }
  }
  for (let i = 0; i < map.mesh.count; i++)
    if (limb.get(i) > moved.climb.get(i)) {
      moved.climb.set(i, limb.get(i));
      frame.overlap.set(
        i,
        Math.max(frame.overlap.get(i), clamp(limb.get(i) / map.mesh.spacing, 0, 1))
      );
    }
  releaseWorking(map, limb);
}
/** The pass's slip: the sheets close up, younger under older, and every leading edge climbs. */
export function slipThrustSheets(
  map: PhysicalField,
  context: PhysicalContext,
  components: BoundaryComponent[],
  frame: OrogenicFrame
) {
  const p = context.Profile,
    slip: PassSlip = {
      shortening: (c) => shorteningOf(map, context, c),
      // A thrust cannot ride past the sheet ahead of it: beyond that the next thrust takes up the slip.
      most: p.OrogenicSheetSpacing * context.Span,
    },
    moved = movedRock(map),
    moves = movesOfPass(map, slip);
  for (let i = 0; i < map.mesh.count; i++) {
    const c = riding(map, components, i);
    if (c) planCell(map, c, frame, moved, moves, slip, i);
  }
  addBackLimbs(map, frame, moved);
  const held = holdRock(map);
  for (let i = 0; i < map.mesh.count; i++) {
    if (moved.left.get(i)) leaveBelt(map, i);
    if (moved.origin.get(i) < 0 && moved.under.get(i) < 0 && moved.climb.get(i) <= 0) continue;
    placeRock(map, i, held, moved);
  }
  releaseHeldRock(map, held);
  releaseWorking(map, moved.origin, moved.under, moved.left);
  return moved.climb;
}
import { MapScale } from "@atlas/domain";
