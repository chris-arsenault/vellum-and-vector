import { MapScale, type Band, type ReadBand } from "@atlas/domain";
import type { PhysicalContext } from "../../../packages/generation/src/world/context";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { meshDeltaX } from "../../../packages/generation/src/world/mesh";
import { rockKindOfCode } from "../../../packages/generation/src/rock/rockCatalogue";
import {
  layerDepth,
  layerKind,
  rockLayers,
} from "../../../packages/generation/src/rock/rockColumn";
import { rockBodies, type BodyGround } from "./reliefBodies";
import { smoothMetric } from "../../../packages/generation/src/world/metricSmoothing";
import {
  releaseWorking,
  retainedArray,
  workingArray,
} from "../../../packages/generation/src/world/physicalNumerics";

/**
 * Whether the world's mechanisms leave what they claim: how much of each step's change runs across
 * the belts rather than along them, whether a pass of mountain building lands in step with the
 * ground it builds on, what relief sits at which size, whether cutting follows rock, whether rock
 * forms bodies and whether interior seams stand up. Observes only; it never writes the map.
 */

type Values = { get(i: number): number };
const units = (value: number) => MapScale.inUnits(value, "native");
/** Smoothing spans: 50, 100 and 200 km on the reference map. */
const smoothingSpans = [0.0125, 0.025, 0.05];
/** Below this a cell's structural grain is too faint to measure against. */
const faintGrain = 0.3;
/** Depth of the exposed-next material probe: 200 m on the reference map. */
const bodyDepthSpan = 0.00005;
const softBelow = 800,
  hardFrom = 1600;
const round = (value: number, places = 0) => {
  const by = 10 ** places;
  return Math.round(value * by) / by;
};

const isLand = (map: PhysicalField, i: number) =>
  map.mesh.membership(i) === 1 && map.Elevation.get(i) > map.EffectiveSeaLevel;
function neighbours(map: PhysicalField, i: number) {
  const found: number[] = [];
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.mesh.membership(j) === 1) found.push(j);
  }
  return found;
}
/** A value's height above the mean of the cells around it. */
function standing(map: PhysicalField, values: Values, i: number) {
  const around = neighbours(map, i);
  if (!around.length) return 0;
  return values.get(i) - around.reduce((sum, j) => sum + values.get(j), 0) / around.length;
}
/** The slope of a field at a cell, fitted to its neighbours. */
function slopeAt(map: PhysicalField, values: Values, i: number) {
  let xx = 0,
    yy = 0,
    xy = 0,
    xz = 0,
    yz = 0;
  for (const j of neighbours(map, i)) {
    const dx = meshDeltaX(map.mesh, map.mesh.x(j) - map.mesh.x(i)),
      dy = map.mesh.y(j) - map.mesh.y(i),
      dz = values.get(j) - values.get(i);
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
    xz += dx * dz;
    yz += dy * dz;
  }
  const det = xx * yy - xy * xy;
  return Math.abs(det) < 1 ? null : [(yy * xz - xy * yz) / det, (xx * yz - xy * xz) / det];
}
/** The way a cell's belt runs, from the grain it recorded when it was built. */
function strike(map: PhysicalField, i: number) {
  const x = map.StructuralGrainX.get(i) / 1000,
    y = map.StructuralGrainY.get(i) / 1000;
  if (Math.hypot(x, y) < faintGrain) return null;
  const angle = 0.5 * Math.atan2(y, x);
  return [Math.cos(angle), Math.sin(angle)];
}
/** How much steeper a field is across the belts than along them; 1 has no preference. */
export function acrossAlong(map: PhysicalField, values: Values) {
  let across = 0,
    along = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const axis = isLand(map, i) ? strike(map, i) : null,
      slope = axis && slopeAt(map, values, i);
    if (!axis || !slope) continue;
    along += (slope[0] * axis[0] + slope[1] * axis[1]) ** 2;
    across += (slope[1] * axis[0] - slope[0] * axis[1]) ** 2;
  }
  return along > 0 ? round(Math.sqrt(across / along), 2) : null;
}
/** What `acrossAlong` reads for perfect ridges along the same grain, on this mesh. */
function perfectRidges(map: PhysicalField, spacing: number) {
  const ridges = workingArray(map, "float64", "probe:ridges");
  for (let i = 0; i < map.mesh.count; i++) {
    const axis = strike(map, i);
    if (axis)
      ridges.set(
        i,
        Math.sin((2 * Math.PI * (map.mesh.y(i) * axis[0] - map.mesh.x(i) * axis[1])) / spacing)
      );
  }
  const read = acrossAlong(map, ridges);
  releaseWorking(map, ridges);
  return read;
}
function shortPart(map: PhysicalField, values: ReadBand, length: number) {
  const smooth = smoothMetric(map, values, length);
  for (let i = 0; i < smooth.length; i++) smooth.set(i, values.get(i) - smooth.get(i));
  return smooth;
}
function correlation(map: PhysicalField, a: Values, b: Values) {
  let n = 0,
    sa = 0,
    sb = 0,
    aa = 0,
    bb = 0,
    ab = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    const x = a.get(i),
      y = b.get(i);
    n++;
    sa += x;
    sb += y;
    aa += x * x;
    bb += y * y;
    ab += x * y;
  }
  const spread = (aa - (sa * sa) / n) * (bb - (sb * sb) / n);
  return spread > 0 ? round((ab - (sa * sb) / n) / Math.sqrt(spread), 3) : null;
}
/** Relief by size: the root-mean-square height held between each smoothing and the next. */
function reliefBySize(map: PhysicalField, field: ReadBand) {
  const scales = smoothingSpans.map((span) => map.scale.length(span)),
    smoothed = scales.map((length) => smoothMetric(map, field, length)),
    levels: Values[] = [field, ...smoothed],
    held = new Array<number>(scales.length + 1).fill(0);
  let count = 0,
    broad = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (isLand(map, i)) {
      count++;
      broad += smoothed[scales.length - 1].get(i);
    }
  broad /= count;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    scales.forEach((_, k) => (held[k] += (levels[k].get(i) - levels[k + 1].get(i)) ** 2));
    held[scales.length] += (levels[scales.length].get(i) - broad) ** 2;
  }
  releaseWorking(map, ...smoothed);
  return Object.fromEntries(
    held.map((sum, k) => [
      k < scales.length
        ? `under${MapScale.inUnits(scales[k], "km")}km`
        : `over${MapScale.inUnits(scales[k - 1], "km")}km`,
      round(MapScale.metres(Math.sqrt(sum / count), "native")),
    ])
  );
}
const hardness = (map: PhysicalField, i: number) => {
  const rock = map.RockResistance.get(i);
  return rock < softBelow ? "soft" : rock < hardFrom ? "middle" : "hard";
};
/** A tally of a value by group, read back as each group's count and mean. */
function tally() {
  const groups = new Map<string, { cells: number; total: number }>();
  return {
    add(group: string, value: number) {
      const held = groups.get(group) ?? { cells: 0, total: 0 };
      held.cells++;
      held.total += value;
      groups.set(group, held);
    },
    read: () =>
      Object.fromEntries(
        [...groups].map(([group, { cells, total }]) => [
          group,
          { cells, mean: round(total / cells, 1) },
        ])
      ),
  };
}
/** How far rock of each hardness stands above the ground around it. */
function rockStanding(map: PhysicalField) {
  const stands = tally();
  for (let i = 0; i < map.mesh.count; i++)
    if (isLand(map, i))
      stands.add(hardness(map, i), MapScale.metres(standing(map, map.Elevation, i), "native"));
  return stands.read();
}
/** How often a land cell's land neighbour is the same rock: low means confetti, high bodies. */
function sameRockAround(map: PhysicalField) {
  let same = 0,
    pairs = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    for (const j of neighbours(map, i)) {
      if (!isLand(map, j)) continue;
      pairs++;
      if (map.RockKindCodes.get(j) === map.RockKindCodes.get(i)) same++;
    }
  }
  return pairs ? round(same / pairs, 3) : null;
}
/** The rock a set depth below the surface, where erosion would next uncover it. */
function rockAtDepth(map: PhysicalField, i: number, depth: number) {
  let left = depth;
  for (let layer = 0; layer < rockLayers; layer++) {
    const thick = layerDepth(map, i, layer);
    if (thick > left) return layerKind(map, i, layer);
    left -= thick;
  }
  for (let layer = rockLayers - 1; layer >= 0; layer--)
    if (layerDepth(map, i, layer) > 0) return layerKind(map, i, layer);
  return layerKind(map, i, 0);
}
function bodyGround(map: PhysicalField): BodyGround {
  let area = 0,
    land = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (isLand(map, i)) {
      area += map.mesh.area(i);
      land++;
    }
  return {
    count: map.mesh.count,
    cellKm2: land ? MapScale.areaUnits(area / land, "m2", "km2") : 0,
    included: (i) => isLand(map, i),
    around: (i) => neighbours(map, i),
    x: (i) => map.mesh.x(i),
    y: (i) => map.mesh.y(i),
    deltaX: (d) => meshDeltaX(map.mesh, d),
    strike: (i) => strike(map, i),
  };
}
/** Bodies of connected rock: by kind and by family, on the surface and where cutting will reach. */
function rockBodiesOf(map: PhysicalField) {
  const ground = bodyGround(map),
    bodiesDeep = map.scale.length(bodyDepthSpan),
    deep = units(bodiesDeep),
    surface = (i: number) => map.RockKindCodes.get(i),
    below = (i: number) => rockAtDepth(map, i, deep),
    family = (code: (i: number) => number) => (i: number) => rockKindOfCode(code(i)).family;
  return {
    kind: { surface: rockBodies(ground, surface), [`at${bodiesDeep}m`]: rockBodies(ground, below) },
    family: {
      surface: rockBodies(ground, family(surface)),
      [`at${bodiesDeep}m`]: rockBodies(ground, family(below)),
    },
  };
}
const atSeam = (map: PhysicalField, i: number) =>
  map.CrustSutureStrength.get(i) > 100 ||
  neighbours(map, i).some(
    (j) =>
      map.CrustProvinceIds.get(j) !== map.CrustProvinceIds.get(i) &&
      map.CrustContinentalFraction.get(j) >= 500
  );
/** Continental interiors: how seams stand next to the ground between them. */
function interiorSeams(map: PhysicalField) {
  const stands = tally(),
    heights = tally();
  for (let i = 0; i < map.mesh.count; i++) {
    if (
      !isLand(map, i) ||
      map.TectonicBoundaryCodes.get(i) !== 0 ||
      map.CrustContinentalFraction.get(i) < 500
    )
      continue;
    const group = atSeam(map, i) ? "seam" : "between";
    stands.add(group, MapScale.metres(standing(map, map.Elevation, i), "native"));
    heights.add(group, MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native"));
  }
  return { standing: stands.read(), height: heights.read() };
}
function finalState(map: PhysicalField, spacing: number) {
  return {
    reliefBySize: {
      height: reliefBySize(map, map.Elevation),
      crustSupport: reliefBySize(map, map.CrustSupportElevation),
      rockLoad: reliefBySize(map, map.SurfaceRockLoad),
    },
    acrossAlong: {
      height: acrossAlong(map, map.Elevation),
      crustSupport: acrossAlong(map, map.CrustSupportElevation),
      rockLoad: acrossAlong(map, map.SurfaceRockLoad),
      perfectRidges: perfectRidges(map, spacing),
    },
    rockStanding: rockStanding(map),
    rockBodies: rockBodiesOf(map),
    thrustsStand: thrustsStand(map),
    sameRockAround: sameRockAround(map),
    interiorSeams: interiorSeams(map),
  };
}
/** What one step changed on land, or null when it changed nothing there. */
function stepChange(name: string, map: PhysicalField, epoch: number, change: Band) {
  let cells = 0,
    total = 0,
    short = 0,
    up = 0,
    down = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    const moved = MapScale.metres(change.get(i), "native");
    cells++;
    total += moved * moved;
    short += MapScale.metres(standing(map, change, i), "native") ** 2;
    if (moved > 0) up += moved;
    else down -= moved;
  }
  if (!cells || total === 0) return null;
  return {
    name,
    epoch,
    rms: round(Math.sqrt(total / cells), 1),
    shortRms: round(Math.sqrt(short / cells), 1),
    meanUp: round(up / cells, 1),
    meanDown: round(down / cells, 1),
    changeAcrossAlong: acrossAlong(map, change),
    heightAcrossAlong: acrossAlong(map, map.Elevation),
  };
}
/** A cell with another sheet of its own belt beside it lies on a thrust between them. */
const atThrust = (map: PhysicalField, i: number) =>
  map.ThrustPairIds.get(i) > 0 &&
  neighbours(map, i).some(
    (j) =>
      map.ThrustPairIds.get(j) === map.ThrustPairIds.get(i) &&
      map.ThrustSheetIndex.get(j) !== map.ThrustSheetIndex.get(i)
  );
/** How far thrusts stand above the rest of their sheets: ridges in the sheets' own place. */
export function thrustsStand(map: PhysicalField) {
  const height = tally(),
    rock = tally();
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i) || !map.ThrustPairIds.get(i)) continue;
    const group = atThrust(map, i) ? "thrust" : "behind";
    height.add(group, MapScale.metres(standing(map, map.Elevation, i), "native"));
    rock.add(group, MapScale.metres(standing(map, map.SurfaceRockLoad, i), "native"));
  }
  return { height: height.read(), rock: rock.read() };
}
function cellsInSheets(map: PhysicalField) {
  let count = 0;
  for (let i = 0; i < map.mesh.count; i++) if (isLand(map, i) && map.ThrustPairIds.get(i)) count++;
  return count;
}
/** Whether a pass of mountain building lands in step with the ridges it lands on. */
function passInStep(
  map: PhysicalField,
  epoch: number,
  change: Band,
  before: Band,
  spacing: number
) {
  const written = shortPart(map, change, spacing),
    ground = shortPart(map, before, spacing),
    result = {
      epoch,
      writtenVsGround: correlation(map, written, ground),
      cellsInSheets: cellsInSheets(map),
      thrustsStand: thrustsStand(map),
      perfectRidges: perfectRidges(map, spacing),
    };
  releaseWorking(map, written, ground);
  return result;
}
/** What a river pass cut in rock of each hardness. */
function cutsByRock(map: PhysicalField, epoch: number, was: Band) {
  const cuts = tally();
  for (let i = 0; i < map.mesh.count; i++) {
    const cut = MapScale.metres(map.CumulativeFluvialErosion.get(i) - was.get(i), "native");
    if (cut > 0 && isLand(map, i)) cuts.add(hardness(map, i), cut);
    was.set(i, map.CumulativeFluvialErosion.get(i));
  }
  return { epoch, ...cuts.read() };
}
/** Starts a set of probes: `observe` after every step, `read` for what they saw. */
export function reliefProbes() {
  const steps: object[] = [],
    passes: object[] = [],
    cuts: object[] = [];
  let held: { map: PhysicalField; height: Band; cut: Band } | null = null,
    final: object | null = null;
  const observe = (name: string, map: PhysicalField, context: PhysicalContext) => {
    if (held?.map !== map)
      held = {
        map,
        height: retainedArray(map, "float64", "probe:height"),
        cut: retainedArray(map, "float64", "probe:cut"),
      };
    else {
      const spacing = context.Profile.OrogenicSheetSpacing,
        change = workingArray(map, "float64", "probe:change");
      for (let i = 0; i < map.mesh.count; i++)
        change.set(i, map.Elevation.get(i) - held.height.get(i));
      const step = stepChange(name, map, context.EpochIndex, change);
      if (step) steps.push(step);
      if (name === "orogenic-construction" || name === "plate-advection")
        passes.push({ name, ...passInStep(map, context.EpochIndex, change, held.height, spacing) });
      if (name === "ancestral-fluvial-erosion")
        cuts.push(cutsByRock(map, context.EpochIndex, held.cut));
      if (name === "physical-structural-validation") final = finalState(map, spacing);
      releaseWorking(map, change);
    }
    for (let i = 0; i < map.mesh.count; i++) held.height.set(i, map.Elevation.get(i));
  };
  return { observe, read: () => ({ steps, passes, cuts, final }) };
}
