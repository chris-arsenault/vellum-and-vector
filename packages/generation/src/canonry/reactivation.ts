import type { PhysicalContext } from "./context";
import { adjustCrustColumn } from "./crustTransport";
import type { PhysicalField } from "./field";
import { buoyancy, clamp, thickness, toUnits, units } from "./math";
import { metricSearch } from "./metricSearch";
import { releaseWorking, workingArray } from "./physicalNumerics";
import { stripRock } from "../rock/rockColumn";
import { rebuild } from "./surface";

/**
 * A plate squeezed at its edge breaks where it is already weak. Old sutures and the seams between
 * crustal provinces take up far-field stress across a zone of broken crust around them, so a
 * continent's interior thickens into ranges along them while its margin is being pushed, and thins
 * into basins while its margin is being pulled apart. The seams stay with the crust, so each pass
 * works the same ones again. Nothing here is placed: a seam moves only if its plate is under stress.
 */

/** How weak the seam between two provinces is, next to a suture of full strength. */
const provinceSeam = 0.4;
/** Below this much crust a cell is not part of a continent's stiff interior. */
const interiorFraction = 500;
/** How sharply weakness concentrates what the plate transmits. */
const concentration = 1.5;
/** The share of a seam's movement that is rock at the surface; the rest is in the crust beneath. */
const surfaceShare = 0.35;
/** How much older rock comes up, for each metre a seam's rock rises. */
const exhumation = 1.5;

/** Each plate's mean signed strain along its edges: squeezing is positive, pulling negative. */
function plateStress(map: PhysicalField) {
  let slots = 0;
  for (let i = 0; i < map.mesh.count; i++) slots = Math.max(slots, plateSlot(map, i) + 1);
  const strain = new Float64Array(slots),
    areas = new Float64Array(slots);
  for (let i = 0; i < map.mesh.count; i++) {
    const code = map.TectonicBoundaryCodes.get(i);
    if (code !== 1 && code !== 2) continue;
    const plate = plateSlot(map, i),
      area = map.mesh.area(i);
    strain[plate] += ((code === 1 ? 1 : -1) * map.TectonicStrain.get(i) * area) / 1000;
    areas[plate] += area;
  }
  for (let plate = 0; plate < slots; plate++)
    strain[plate] = areas[plate] > 0 ? strain[plate] / areas[plate] : 0;
  return strain;
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
function weakness(map: PhysicalField, i: number) {
  const suture = map.CrustSutureStrength.get(i) / 1000;
  return Math.max(suture, atProvinceSeam(map, i) ? provinceSeam : 0);
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
/** A seam's zone moves: its crust thickens or thins, and its rock rises or sags on top of that. */
function moveSeam(map: PhysicalField, i: number, metres: number) {
  const inCrust = metres * (1 - surfaceShare),
    fraction = map.CrustContinentalFraction.get(i) / 1000,
    current = toUnits(map.CrustThickness.get(i)),
    rock = units(metres * surfaceShare);
  adjustCrustColumn(map, i, units(thickness(current + inCrust / (buoyancy(fraction) / 1000))));
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
  const stress = plateStress(map),
    reach = p.SutureReactivationZone,
    { distance, weak } = weakZones(map, reach);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!inInterior(map, i) || weak.get(i) <= 0) continue;
    const pushed = clamp(stress[plateSlot(map, i)], -1, 1),
      fading = (1 - distance.get(i) / reach) ** 2;
    if (pushed !== 0) moveSeam(map, i, step * pushed * weak.get(i) ** concentration * fading);
  }
  releaseWorking(map, distance, weak);
}
