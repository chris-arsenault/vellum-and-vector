import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "./context";
import { adjustCrustColumn } from "../rock/crustTransport";
import type { PhysicalField } from "./field";
import { buoyancy, clamp, crustPerRock, thickness, toUnits, units } from "./math";
import { metricSearch } from "./metricSearch";
import { addRoot } from "./orogenicRoots";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { displaceGround } from "../rock/groundLedger";
import { markGroundSeam, spendRootReserve } from "../rock/groundWorld";

/**
 * A plate squeezed at its edge breaks where it is already weak. Old sutures and the seams between
 * crustal provinces take up far-field stress across a zone of broken crust around them, so a
 * continent's interior thickens into ranges along them while its margin is being pushed, and thins
 * into basins where a rift pulls it apart nearby. The seams stay with the crust, so each pass
 * works the same ones again. Nothing here is placed: a seam moves only if its plate is under stress.
 * A rising seam's crust comes in from across its plate, which is what the plate shortening means.
 */

/** How weak the seam between two provinces is, next to a suture of full strength. */
const provinceSeam = 0.4;
/** Below this much crust a cell is not part of a continent's stiff interior. */
const interiorFraction = 500;
/**
 * The share of a seam's movement that is rock at the surface; the rest is in the crust beneath. A
 * seam's zone is about as narrow as flexure smooths away, so what lifts it is mostly its own rock.
 */
const surfaceShare = 0.7;
/**
 * How gently a plate is squeezed from an edge that is not a collision: an ocean ridge, or ocean going
 * down at its margin, next to continent meeting continent at the same strain.
 */
const gentlePush = 0.5;

/**
 * What an edge cell pushes its plate with. Continent meeting continent loads the whole plate by its
 * strain, as the Himalaya does Asia; ocean going down at a margin, or an ocean ridge, squeezes it more
 * gently, since a slab mostly pulls on its own plate. A rift through a continent pulls.
 */
function edgePush(map: PhysicalField, i: number) {
  const code = map.TectonicBoundaryCodes.get(i),
    strain = map.TectonicStrain.get(i) / 1000;
  if (code === 1) {
    const collision = map.CrustCollisionIntensity.get(i) / 1000;
    return strain * Math.max(gentlePush, collision);
  }
  return code === 2 && map.CrustContinentalFraction.get(i) < interiorFraction
    ? strain * gentlePush
    : 0;
}
/**
 * How hard each plate is squeezed: the strongest push along its edges. Plate interiors are mostly in
 * compression from ridge push and convergence, and one hard collision loads a whole plate, as the
 * Himalaya does Asia. A boundary's strain tapers across its width, so a mean would mostly measure that.
 */
function plateSqueeze(map: PhysicalField) {
  let slots = 0;
  for (let i = 0; i < map.mesh.count; i++) slots = Math.max(slots, plateSlot(map, i) + 1);
  const squeeze = new Float64Array(slots);
  for (let i = 0; i < map.mesh.count; i++) {
    const plate = plateSlot(map, i);
    squeeze[plate] = Math.max(squeeze[plate], edgePush(map, i));
  }
  return squeeze;
}
/**
 * How hard the nearest rift through a continent pulls, and how far off it lies. Extension stays close
 * to the rift that makes it, unlike squeezing, so it rules near the rift and fades out into the squeeze.
 * A rift pulls with its strongest strain, since the strain at its nearest edge has tapered away.
 */
function riftPull(map: PhysicalField, reach: number) {
  const distance = workingArray(map, "float64", "seams:riftDistance").fill(Infinity),
    pull = workingArray(map, "float64", "seams:pull").fill(0),
    isRift = (i: number) =>
      map.TectonicBoundaryCodes.get(i) === 2 &&
      map.CrustContinentalFraction.get(i) >= interiorFraction,
    strongest = new Map<number, number>(); // hpc-exempt: a handful of rifts, keyed by a sparse pair id.
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isRift(i)) continue;
    const pair = map.TectonicBoundaryPairIds.get(i);
    strongest.set(pair, Math.max(strongest.get(pair) ?? 0, map.TectonicStrain.get(i) / 1000));
  }
  function* rifts() {
    for (let i = 0; i < map.mesh.count; i++) {
      if (!isRift(i)) continue;
      pull.set(i, strongest.get(map.TectonicBoundaryPairIds.get(i)) ?? 0);
      distance.set(i, 0);
      yield i;
    }
  }
  metricSearch(map.mesh, rifts(), distance, reach, (target, from) =>
    pull.set(target, pull.get(from))
  );
  return { distance, pull };
}
/** The stress on crust at a cell: squeezing is positive, pulling negative. */
function stressAt(
  map: PhysicalField,
  i: number,
  squeeze: Float64Array,
  rift: ReturnType<typeof riftPull>,
  reach: number
) {
  const near = 1 - Math.min(1, rift.distance.get(i) / reach);
  return squeeze[plateSlot(map, i)] * (1 - near) - rift.pull.get(i) * near;
}
/** A plate's slot in a dense array; a cell with no plate has the first. */
const plateSlot = (map: PhysicalField, i: number) => map.CrustPlateIds.get(i) + 1;
function atProvinceSeam(map: PhysicalField, i: number) {
  const province = map.CrustProvinceIds.get(i);
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (
      j >= 0 &&
      map.CrustProvinceIds.get(j) !== province &&
      map.CrustContinentalFraction.get(j) >= interiorFraction
    )
      return true;
  }
  return false;
}
/**
 * Marks once where crust lies on a seam between provinces. Province ids are worked out afresh from
 * the sites on every pass, but a seam is a property of the crust and travels with it from here on,
 * so that each pass works the same seam and the rock it has already raised.
 */
function markProvinceSeams(map: PhysicalField) {
  if (map.ProvinceSeamsMarked) return;
  map.ProvinceSeamsMarked = true;
  for (let i = 0; i < map.mesh.count; i++)
    if (inInterior(map, i) && atProvinceSeam(map, i)) markGroundSeam(map, i);
}
function weakness(map: PhysicalField, i: number) {
  const suture = map.CrustSutureStrength.get(i) / 1000;
  return Math.max(suture, map.CrustProvinceSeam.get(i) > 0 ? provinceSeam : 0);
}
const inInterior = (map: PhysicalField, i: number) =>
  map.TectonicBoundaryCodes.get(i) === 0 && map.CrustContinentalFraction.get(i) >= interiorFraction;
/** How weak the crust is around its seams: each cell as weak as its nearest seam, fading outward. */
function weakZones(map: PhysicalField, reach: number) {
  const distance = workingArray(map, "float64", "seams:distance").fill(Infinity),
    weak = workingArray(map, "float64", "seams:weak").fill(0);
  function* seams() {
    for (let i = 0; i < map.mesh.count; i++) {
      if (!inInterior(map, i)) continue;
      const here = weakness(map, i);
      if (here <= 0) continue;
      weak.set(i, here);
      distance.set(i, 0);
      yield i;
    }
  }
  metricSearch(map.mesh, seams(), distance, reach, (target, from) =>
    weak.set(target, weak.get(from))
  );
  return { distance, weak };
}
/** The crust a seam's move takes at a cell, in metres of column. */
const crustFor = (map: PhysicalField, i: number, metres: number) =>
  (metres * (1 - surfaceShare)) / (buoyancy(map.CrustContinentalFraction.get(i) / 1000) / 1000);
/** The root volume, as root reserves count it, that a column of this many metres holds. */
const rootVolume = (map: PhysicalField, i: number, column: number) => column * map.mesh.area(i);
/** All a seam's rise takes, crust and rock together, in metres of column. */
const riseTakes = (map: PhysicalField, i: number, metres: number) =>
  crustFor(map, i, metres) +
  metres * surfaceShare * crustPerRock(map.CrustContinentalFraction.get(i) / 1000);
/**
 * The root crust at a cell that a seam may draw on: what this pass's shortening brought and the
 * belt did not take up. Reserve left from earlier passes is the belt's, stuck where it is full.
 */
const unspentThisPass = (map: PhysicalField, i: number) =>
  Math.max(0, Math.min(map.CrustRootReserve.get(i), map.ConvergentCrustSurplus.get(i)));
/** What each plate has to thicken its seams with: this pass's shortening that its belts left. */
function plateMaterial(map: PhysicalField, rise: Band, slots: number) {
  const wanted = new Float64Array(slots),
    roots = new Float64Array(slots);
  for (let i = 0; i < map.mesh.count; i++) {
    const plate = plateSlot(map, i);
    roots[plate] += (unspentThisPass(map, i) * map.mesh.area(i)) / 1024;
    if (rise.get(i) > 0) wanted[plate] += rootVolume(map, i, riseTakes(map, i, rise.get(i)));
  }
  return { wanted, roots };
}
/**
 * What share of its seams' rise each plate has the material for, and that material spent. A seam
 * thickens with the shortening its plate's edge did not take up this pass: the root crust that
 * arrived and the belts could not use. Once that is spent the seam rises no further, since a plate
 * does not thin itself across its whole body to feed a seam.
 */
function spendPlateCrust(map: PhysicalField, rise: Band, slots: number) {
  const { wanted, roots } = plateMaterial(map, rise, slots),
    paid = new Float64Array(slots),
    fromRoots = new Float64Array(slots);
  for (let plate = 0; plate < slots; plate++) {
    if (wanted[plate] <= 0) continue;
    paid[plate] = Math.min(1, roots[plate] / wanted[plate]);
    fromRoots[plate] = roots[plate] > 0 ? (paid[plate] * wanted[plate]) / roots[plate] : 0;
  }
  for (let i = 0; i < map.mesh.count; i++)
    spendRootReserve(map, i, unspentThisPass(map, i) * fromRoots[plateSlot(map, i)]);
  return paid;
}
/** A seam's zone moves: its crust thickens or thins, and its rock rises or sags on top of that. */
function moveSeam(map: PhysicalField, i: number, metres: number) {
  const rock = units(metres * surfaceShare),
    crust = crustFor(map, i, metres);
  if (metres > 0) addRoot(map, i, rootVolume(map, i, crust));
  else adjustCrustColumn(map, i, units(thickness(toUnits(map.CrustThickness.get(i)) + crust)));
  displaceGround(map, i, rock, "mountains");
  if (rock > 0) {
    // Thickening drives burial and heat; uplift alone does not uncover the deeper beds.
    map.OrogenicConstruction.set(i, Math.max(map.OrogenicConstruction.get(i), rock));
  }
}
export function sutureReactivation(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile,
    step = (p.SutureReactivationPerSpan * context.Span * context.TectonicStrength) / 1000;
  if (step <= 0) return;
  markProvinceSeams(map);
  const squeeze = plateSqueeze(map),
    reach = p.SutureReactivationZone,
    { distance, weak } = weakZones(map, reach),
    rift = riftPull(map, reach),
    moves = workingArray(map, "float64", "seams:moves").fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!inInterior(map, i) || weak.get(i) <= 0) continue;
    const stress = stressAt(map, i, squeeze, rift, reach),
      fading = (1 - distance.get(i) / reach) ** 2;
    moves.set(i, step * clamp(stress, -1, 1) * weak.get(i) * fading);
  }
  const paid = spendPlateCrust(map, moves, squeeze.length);
  for (let i = 0; i < map.mesh.count; i++) {
    const move = moves.get(i);
    if (move !== 0) moveSeam(map, i, move > 0 ? move * paid[plateSlot(map, i)] : move);
  }
  releaseWorking(map, distance, weak, rift.distance, rift.pull, moves);
}
