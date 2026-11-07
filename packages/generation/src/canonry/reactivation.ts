import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "./context";
import { adjustCrustColumn } from "./crustTransport";
import type { PhysicalField } from "./field";
import { buoyancy, clamp, thickness, toUnits, units } from "./math";
import { metricSearch } from "./metricSearch";
import { addRoot } from "./orogenicRoots";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { stripRock } from "../rock/rockColumn";
import { rebuild } from "./surface";

/**
 * A plate squeezed at its edge breaks where it is already weak. Old sutures and the seams between
 * crustal provinces take up far-field stress across a zone of broken crust around them, so a
 * continent's interior thickens into ranges along them while its margin is being pushed, and thins
 * into basins where a rift pulls it apart nearby. The seams stay with the crust, so each pass
 * works the same ones again. Nothing here is placed: a seam moves only if its plate is under stress.
 * A rising seam's crust is the root crust its plate's belts have shortened and not yet used.
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
/** How hard an ocean ridge squeezes a plate, next to a converging edge of the same strain. */
const ridgePush = 0.5;
/** How much older rock comes up, for each metre a seam's rock rises. */
const exhumation = 1.5;

/**
 * What an edge cell pushes its plate with: a converging edge by its strain, whether a collision or
 * ocean going down at a margin, and an ocean ridge more gently. A rift through a continent pulls.
 */
function edgePush(map: PhysicalField, i: number) {
  const code = map.TectonicBoundaryCodes.get(i),
    strain = map.TectonicStrain.get(i) / 1000;
  if (code === 1) return strain;
  return code === 2 && map.CrustContinentalFraction.get(i) < interiorFraction
    ? strain * ridgePush
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
    if (inInterior(map, i) && atProvinceSeam(map, i)) map.CrustProvinceSeam.set(i, 1);
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
/**
 * What share of its seams' rise each plate's root crust can pay for, and that crust spent from its
 * reserves. The zone's own shortening supplies the rest.
 */
function spendRoots(map: PhysicalField, rise: Band, slots: number) {
  const wanted = new Float64Array(slots),
    held = new Float64Array(slots),
    paid = new Float64Array(slots);
  for (let i = 0; i < map.mesh.count; i++) {
    const plate = plateSlot(map, i);
    held[plate] += (map.CrustRootReserve.get(i) * map.mesh.area(i)) / 1024;
    if (rise.get(i) > 0) wanted[plate] += rootVolume(map, i, crustFor(map, i, rise.get(i)));
  }
  for (let plate = 0; plate < slots; plate++)
    paid[plate] = wanted[plate] > 0 ? Math.min(1, held[plate] / wanted[plate]) : 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const plate = plateSlot(map, i);
    if (held[plate] > 0 && paid[plate] > 0)
      map.CrustRootReserve.set(
        i,
        map.CrustRootReserve.get(i) * (1 - (paid[plate] * wanted[plate]) / held[plate])
      );
  }
  return paid;
}
/** A seam's zone moves: its crust thickens or thins, and its rock rises or sags on top of that. */
function moveSeam(map: PhysicalField, i: number, metres: number, paid: number) {
  const rock = units(metres * surfaceShare),
    crust = crustFor(map, i, metres),
    fromRoots = metres > 0 ? crust * paid : 0;
  if (fromRoots > 0) addRoot(map, i, rootVolume(map, i, fromRoots));
  adjustCrustColumn(
    map,
    i,
    units(thickness(toUnits(map.CrustThickness.get(i)) + crust - fromRoots))
  );
  map.BedrockElevation.add(i, rock);
  map.SurfaceRockLoad.add(i, rock);
  if (rock > 0) {
    // What a seam builds is buried and baked as what any belt builds is, and brings up older rock.
    map.OrogenicConstruction.set(i, Math.max(map.OrogenicConstruction.get(i), rock));
    stripRock(map, i, Math.round(rock * exhumation));
  }
  rebuild(map, i);
}
export function sutureReactivation(map: PhysicalField, context: PhysicalContext) {
  const p = context.Profile,
    step = (p.SutureReactivationStep * context.TectonicStrength) / 1000;
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
  const paid = spendRoots(map, moves, squeeze.length);
  for (let i = 0; i < map.mesh.count; i++) {
    const move = moves.get(i);
    if (move !== 0) moveSeam(map, i, move, paid[plateSlot(map, i)]);
  }
  releaseWorking(map, distance, weak, rift.distance, rift.pull, moves);
}
