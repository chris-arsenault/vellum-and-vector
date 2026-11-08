import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "./context";
import { adjustCrustColumn } from "../rock/crustTransport";
import type { PhysicalField } from "./field";
import { buoyancy, clamp, crustPerRock, thickness, toUnits, units } from "./math";
import { metricSearch } from "./metricSearch";
import { addRoot } from "./orogenicRoots";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { deformGround, displaceGroundField, shiftGroundField } from "../rock/groundDeformation";
import { groundOf } from "../rock/ground";
import { yieldingPlane } from "../rock/groundQueries";
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
 * Each plate retains the direction of its loading. Opposed pushes reinforce compression along
 * their shared axis; differently oriented contacts do not become one directionless maximum.
 */
function plateSqueeze(map: PhysicalField) {
  let slots = 0;
  for (let i = 0; i < map.mesh.count; i++) slots = Math.max(slots, plateSlot(map, i) + 1);
  const xx = new Float64Array(slots),
    xy = new Float64Array(slots),
    yy = new Float64Array(slots),
    weight = new Float64Array(slots),
    maximum = new Float64Array(slots);
  for (let i = 0; i < map.mesh.count; i++) {
    const plate = plateSlot(map, i),
      push = edgePush(map, i),
      tx = map.TectonicTangentX.get(i),
      ty = map.TectonicTangentY.get(i),
      length = Math.hypot(tx, ty);
    if (push <= 0 || length <= 0) continue;
    const nx = -ty / length,
      ny = tx / length;
    xx[plate] += push * nx * nx;
    xy[plate] += push * nx * ny;
    yy[plate] += push * ny * ny;
    weight[plate] += push;
    maximum[plate] = Math.max(maximum[plate], push);
  }
  for (let plate = 0; plate < slots; plate++) {
    const scale = weight[plate] > 0 ? maximum[plate] / weight[plate] : 0;
    xx[plate] *= scale;
    xy[plate] *= scale;
    yy[plate] *= scale;
  }
  return { xx, xy, yy };
}
/**
 * How hard the nearest rift through a continent pulls, and how far off it lies. Extension stays close
 * to the rift that makes it, unlike squeezing, so it rules near the rift and fades out into the squeeze.
 * A rift pulls with its strongest strain, since the strain at its nearest edge has tapered away.
 */
function riftPull(map: PhysicalField, reach: number) {
  const distance = workingArray(map, "float64", "seams:riftDistance").fill(Infinity),
    pull = workingArray(map, "float64", "seams:pull").fill(0),
    source = workingArray(map, "int32", "seams:riftSource").fill(-1),
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
      source.set(i, i);
      distance.set(i, 0);
      yield i;
    }
  }
  metricSearch(map.mesh, rifts(), distance, reach, (target, from) => {
    pull.set(target, pull.get(from));
    source.set(target, source.get(from));
  });
  return { distance, pull, source };
}
/** Resolve a directional horizontal load on an inherited axial weakness; unknown fabric is isotropic. */
export function resolvedLoading(
  xx: number,
  xy: number,
  yy: number,
  grainX: number,
  grainY: number
) {
  const coherence = clamp(Math.hypot(grainX, grainY) / 1000, 0, 1),
    angle = Math.atan2(grainY, grainX) / 2,
    tx = Math.cos(angle),
    ty = Math.sin(angle),
    nx = -ty,
    ny = tx,
    normal = xx * nx * nx + 2 * xy * nx * ny + yy * ny * ny,
    shear = Math.abs(tx * (xx * nx + xy * ny) + ty * (xy * nx + yy * ny)),
    directed = normal + Math.sign(normal) * shear;
  return ((xx + yy) / 2) * (1 - coherence) + directed * coherence;
}
/** A stronger favorably oriented bed can yield before a weaker bed the load does not engage. */
export const loadedPlane = (xx: number, xy: number, yy: number) =>
  yieldingPlane((material) => resolvedLoading(xx, xy, yy, material.grainX, material.grainY));
/** Squeezing is positive, pulling negative; both retain the direction of the contact applying them. */
function stressAt(
  map: PhysicalField,
  i: number,
  squeeze: ReturnType<typeof plateSqueeze>,
  rift: ReturnType<typeof riftPull>,
  reach: number
) {
  const near = 1 - Math.min(1, rift.distance.get(i) / reach),
    plate = plateSlot(map, i),
    source = rift.source.get(i),
    tx = source >= 0 ? map.TectonicTangentX.get(source) : 0,
    ty = source >= 0 ? map.TectonicTangentY.get(source) : 0,
    length = Math.max(1, Math.hypot(tx, ty)),
    nx = -ty / length,
    ny = tx / length,
    pull = rift.pull.get(i) * near;
  return groundOf(map).fold(
    i,
    loadedPlane(
      squeeze.xx[plate] - pull * nx * nx,
      squeeze.xy[plate] - pull * nx * ny,
      squeeze.yy[plate] - pull * ny * ny
    )
  );
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
  if (rock > 0) {
    // Thickening drives burial and heat; uplift alone does not uncover the deeper beds.
    map.OrogenicConstruction.set(i, Math.max(map.OrogenicConstruction.get(i), rock));
  }
  return rock;
}
function loadStrike(
  map: PhysicalField,
  i: number,
  move: number,
  squeeze: ReturnType<typeof plateSqueeze>,
  riftSource: number
) {
  if (move < 0 && riftSource >= 0)
    return Math.atan2(map.TectonicTangentY.get(riftSource), map.TectonicTangentX.get(riftSource));
  const plate = plateSlot(map, i);
  return Math.atan2(2 * squeeze.xy[plate], squeeze.xx[plate] - squeeze.yy[plate]) / 2 + Math.PI / 2;
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
    moves = workingArray(map, "float64", "seams:moves").fill(0),
    displacement = workingArray(map, "float64", "seams:displacement").fill(0),
    raised = workingArray(map, "float64", "seams:raised").fill(0);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!inInterior(map, i) || weak.get(i) <= 0) continue;
    const { response, mobility } = stressAt(map, i, squeeze, rift, reach),
      width = reach * Math.sqrt(mobility),
      fading = width > 0 ? Math.max(0, 1 - distance.get(i) / width) ** 2 : 0;
    moves.set(i, step * clamp(response, -1, 1) * weak.get(i) * fading);
  }
  const paid = spendPlateCrust(map, moves, squeeze.xx.length);
  for (let i = 0; i < map.mesh.count; i++) {
    const move = moves.get(i);
    if (move === 0) continue;
    const plate = plateSlot(map, i),
      admitted = move > 0 ? move * paid[plate] : move,
      angle = loadStrike(map, i, move, squeeze, rift.source.get(i));
    const movement = moveSeam(map, i, admitted);
    // Compression spends crust to raise standing rock, whose load must drive flexure.
    // Extension offsets the retained column without inventing a negative surface deposit.
    raised.set(i, Math.max(0, movement));
    displacement.set(i, Math.min(0, movement));
    deformGround(map, i, Math.cos(angle), Math.sin(angle), weak.get(i), units(Math.abs(admitted)));
  }
  displaceGroundField(map, displacement, "reactivation");
  shiftGroundField(map, raised, "reactivation");
  releaseWorking(
    map,
    distance,
    weak,
    rift.distance,
    rift.pull,
    rift.source,
    moves,
    displacement,
    raised
  );
}
