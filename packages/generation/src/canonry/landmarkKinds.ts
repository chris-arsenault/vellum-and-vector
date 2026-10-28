// Point landmarks and the escarpment: causes, signatures and corrections per catalogue kind.
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { Feature } from "./codes";
import { clamp, rockResistance, round, units } from "./math";
import { nearestTriangle } from "./mesh";
import { prominence } from "./landforms";
import { shapeImpact } from "./impacts";
import {
  cut,
  distance,
  excavate,
  heightSampler,
  mean,
  metres,
  nearestOnPath,
  pathMetrics,
  realizedAt,
  ring,
  shiftBedrock,
  unitsAbove,
  type PathHit,
  type Placed,
} from "./landmarkGeometry";
import type { Kind } from "./landmarkKind";
import { canyon } from "./landmarkCanyon";
import { falls } from "./landmarkFalls";
import { magicLandmarkKinds } from "./landmarkMagic";

/* ---------- great mountain ---------- */

function mountainCells(map: PhysicalField, placed: Placed) {
  const radius = placed.parameters.baseRadius * 1000,
    cells: [number, number][] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const d = distance(map, i, placed.center);
    if (d <= radius) cells.push([i, d]);
  }
  return { radius, cells };
}
/** The highest cell within the base, which is the summit the signature measures. */
function summitCell(map: PhysicalField, placed: Placed) {
  let summit: [number, number] | null = null;
  for (const cell of mountainCells(map, placed).cells)
    if (!summit || map.Elevation[cell[0]] > map.Elevation[summit[0]]) summit = cell;
  return summit;
}
/**
 * Build the cone so the cell at `anchor` metres from the centre rises by the full height and
 * the rest falls away with the kind's shape.
 */
function raiseMountain(
  map: PhysicalField,
  p: PhysicalProfile,
  placed: Placed,
  height: number,
  volcanic: boolean,
  epoch: number,
  anchor: number
) {
  const { radius, cells } = mountainCells(map, placed);
  const shape = (d: number) => (volcanic ? (1 - d / radius) ** 2 : 1 - (d / radius) ** 2);
  const reference = Math.max(1e-3, shape(anchor));
  let applied = 0;
  for (const [i, d] of cells) {
    const t = 1 - d / radius,
      profile = Math.min(1, shape(d) / reference);
    applied = Math.max(applied, shiftBedrock(map, i, round(height * profile)));
    map.RockResistance[i] = Math.max(
      map.RockResistance[i],
      rockResistance(
        volcanic ? 1000 + (p.VolcanicRockResistance - 1000) * profile : 1000 + 3000 * Math.sqrt(t)
      )
    );
    if (volcanic) volcanicCauses(map, i, d, radius, t, height * profile, epoch);
  }
  return applied;
}
function volcanicCauses(
  map: PhysicalField,
  i: number,
  d: number,
  radius: number,
  t: number,
  raise: number,
  epoch: number
) {
  const activity = round(1000 * t);
  map.VolcanicConstructionHistory[i] += Math.max(0, round(raise));
  map.VolcanicActivity[i] = Math.max(map.VolcanicActivity[i], activity);
  map.VolcanicLastActiveEpoch[i] = Math.max(map.VolcanicLastActiveEpoch[i], epoch);
  map.FractureConductance[i] = Math.max(
    map.FractureConductance[i],
    Math.trunc((activity * 7) / 10)
  );
  map.Uplift[i] = Math.max(map.Uplift[i], clamp(t, 0, 1));
  map.FeatureFlags[i] |= d <= radius / 3 ? Feature.VolcanicCone : Feature.LavaPlain;
}
function measureMountain(map: PhysicalField, placed: Placed) {
  const summit = summitCell(map, placed);
  if (!summit) return { summit: NaN, prominence: NaN };
  const rise = prominence(map);
  return { summit: metres(map, map.Elevation[summit[0]]), prominence: rise[summit[0]] / 1024 };
}
function mountain(volcanic: boolean): Kind {
  return {
    emplace(map, p, placed, epoch) {
      const { cells } = mountainCells(map, placed);
      if (!cells.length) return;
      const height = heightSampler(map),
        base = ring(height, placed.center, placed.parameters.baseRadius * 1000);
      const summit = unitsAbove(map, placed.parameters.summit),
        centre = nearestTriangle(map.mesh, ...placed.center);
      const from = Number.isFinite(base)
        ? Math.min(base, map.Elevation[centre])
        : map.Elevation[centre];
      const needed = Math.max(summit - from, units(placed.parameters.prominence));
      const anchor = Math.min(...cells.map(([, d]) => d));
      if (needed > 0) raiseMountain(map, p, placed, needed, volcanic, epoch, anchor);
    },
    measure: measureMountain,
    maintain(map, p, placed, shortfall, epoch) {
      // Rebuild the cone from its centre: the centre reaching the summit target meets the
      // summit measure exactly, and lifts prominence by at least its own shortfall.
      const { cells } = mountainCells(map, placed);
      if (!cells.length) return 0;
      const centre = nearestTriangle(map.mesh, ...placed.center),
        anchor = Math.min(...cells.map(([, d]) => d));
      const needed = Math.max(
        unitsAbove(map, placed.parameters.summit) - map.Elevation[centre],
        units(shortfall.prominence ?? 0)
      );
      if (needed <= 0) return 0;
      const applied = raiseMountain(map, p, placed, needed, volcanic, epoch, anchor);
      for (const [i] of mountainCells(map, placed).cells) map.LandmarkMaintenance[i] += applied;
      return applied;
    },
  };
}

/* ---------- great ring structure ---------- */

function ringGeometry(placed: Placed) {
  const radius = (placed.parameters.diameter * 1000) / 2,
    count = Math.max(1, Math.round(placed.parameters.ringCount)),
    spacing = radius / count;
  return {
    radius,
    count,
    spacing,
    crest: (k: number) => spacing * (k + 0.5),
    trough: (k: number) => spacing * (k + 1),
  };
}
/**
 * The dome's cells split into crests and troughs by where each lies in the ring cycle. Both
 * classes are always populated: when the cells are too few to fall on both phases, the half
 * nearest a crest radius is the crest, so the relief is measured between real cells.
 */
function ringClasses(map: PhysicalField, placed: Placed) {
  const { radius, spacing } = ringGeometry(placed),
    cells: { i: number; phase: number }[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const d = distance(map, i, placed.center);
    if (d <= radius) cells.push({ i, phase: Math.abs((d % spacing) / spacing - 0.5) });
  }
  let split = 0.25;
  if (!cells.some((c) => c.phase < split) || !cells.some((c) => c.phase >= split)) {
    const phases = Float64Array.from(cells, (c) => c.phase).sort();
    split = phases[Math.floor(phases.length / 2)] + 1e-9;
  }
  const crests = new Set(cells.filter((c) => c.phase < split).map((c) => c.i));
  return { cells: cells.map((c) => c.i), crests, radius };
}
const domeRing: Kind = {
  emplace(map, p, placed) {
    const { count } = ringGeometry(placed),
      { cells, crests, radius } = ringClasses(map, placed),
      height = units(placed.parameters.ringRelief * (count + 1)),
      realized = realizedAt(map, placed);
    for (const i of cells) {
      const d = distance(map, i, placed.center);
      shiftBedrock(map, i, round(height * (1 - (d / radius) ** 2)));
      const resistance = realized ? (crests.has(i) ? 3400 : 600) : 2000;
      map.RockResistance[i] = Math.max(map.RockResistance[i], rockResistance(resistance));
    }
  },
  measure(map, placed) {
    // Ring relief is read from the cells the kind shapes: crest cells against trough cells.
    const { cells, crests } = ringClasses(map, placed),
      up: number[] = [],
      down: number[] = [];
    for (const i of cells) (crests.has(i) ? up : down).push(map.Elevation[i]);
    return { ringRelief: (mean(up) - mean(down)) / 1024 };
  },
  maintain(map, _p, placed, shortfall) {
    // Erosion exposes the rings: the soft troughs are cut. Where base level stops the cut,
    // the resistant crests stand up by the remainder instead.
    const needed = units(shortfall.ringRelief ?? 0);
    if (needed <= 0) return 0;
    const { cells, crests } = ringClasses(map, placed);
    let applied = 0,
      remainder = 0;
    for (const i of cells) {
      if (crests.has(i)) continue;
      const done = cut(map, i, needed);
      map.LandmarkMaintenance[i] += done;
      applied = Math.max(applied, done);
      remainder = Math.max(remainder, needed - done);
    }
    for (const i of crests) {
      const done = shiftBedrock(map, i, round(remainder));
      map.LandmarkMaintenance[i] += done;
      applied = Math.max(applied, done);
    }
    return applied;
  },
};

/** Floor, rim and surrounding plain as cell-band means; the bands are at least a cell wide. */
function craterBands(map: PhysicalField, placed: Placed) {
  const radius = (placed.parameters.diameter * 1000) / 2,
    band = Math.max(radius * 0.2, map.mesh.spacing * 0.6);
  return {
    radius,
    band,
    floor: (d: number) => d <= Math.max(radius * 0.4, map.mesh.spacing * 0.6),
    rim: (d: number) => Math.abs(d - radius) <= band,
    plain: (d: number) =>
      d >= radius * 1.6 && d <= Math.max(radius * 2.4, radius * 1.6 + map.mesh.spacing * 1.2),
  };
}
function craterMeasures(map: PhysicalField, placed: Placed) {
  const bands = craterBands(map, placed),
    floor: number[] = [],
    rim: number[] = [],
    plain: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const d = distance(map, i, placed.center);
    if (bands.floor(d)) floor.push(map.Elevation[i]);
    else if (bands.rim(d)) rim.push(map.Elevation[i]);
    else if (bands.plain(d)) plain.push(map.Elevation[i]);
  }
  return {
    floorDepth: (mean(rim) - mean(floor)) / 1024,
    rimHeight: (mean(rim) - mean(plain)) / 1024,
  };
}
const impactRing: Kind = {
  emplace(map, p, placed) {
    const radius = (placed.parameters.diameter * 1000) / 2;
    shapeImpact(
      map,
      p,
      { x: placed.center[0], y: placed.center[1] },
      radius,
      placed.parameters.floorDepth,
      placed.parameters.rimHeight
    );
  },
  measure(map, placed) {
    const { floorDepth, rimHeight } = craterMeasures(map, placed);
    return { floorDepth, rimHeight };
  },
  maintain(map, _p, placed, shortfall) {
    const bands = craterBands(map, placed),
      deeper = units(shortfall.floorDepth ?? 0),
      higher = units(shortfall.rimHeight ?? 0);
    let applied = 0;
    for (let i = 0; i < map.mesh.count; i++) {
      const d = distance(map, i, placed.center);
      if (deeper > 0 && bands.floor(d)) {
        const done = excavate(map, i, deeper);
        map.LandmarkMaintenance[i] += done;
        applied = Math.max(applied, done);
      }
      if (higher > 0 && bands.rim(d)) {
        const done = shiftBedrock(map, i, higher);
        map.ImpactRimUplift[i] += done;
        map.LandmarkMaintenance[i] += done;
        applied = Math.max(applied, done);
      }
    }
    return applied;
  },
};

/* ---------- great escarpment ---------- */

/** The scarp is at least a cell wide on this mesh, so both sides are read from real cells. */
function scarpCells(map: PhysicalField, placed: Placed) {
  const metrics = pathMetrics(map, placed.path),
    width = Math.max(placed.parameters.scarpWidth * 1000, map.mesh.spacing * 1.2),
    cells: { i: number; hit: PathHit }[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const hit = nearestOnPath(map, metrics, map.mesh.x[i], map.mesh.y[i]);
    if (hit.distance <= width) cells.push({ i, hit });
  }
  return { metrics, width, cells };
}
/** Offset the two sides by half the throw each across the scarp width. */
function throwScarp(
  map: PhysicalField,
  p: PhysicalProfile,
  placed: Placed,
  throwUnits: number,
  book: boolean
) {
  const { width, cells } = scarpCells(map, placed);
  let applied = 0;
  for (const { i, hit } of cells) {
    const ramp = clamp(hit.distance / (width / 2), 0, 1);
    const done = shiftBedrock(map, i, round(hit.side * (throwUnits / 2) * ramp));
    if (book) map.LandmarkMaintenance[i] += Math.abs(done);
    applied = Math.max(applied, Math.abs(done));
  }
  return applied;
}
const escarpment: Kind = {
  emplace(map, p, placed) {
    const { width, cells } = scarpCells(map, placed);
    throwScarp(map, p, placed, units(placed.parameters.throw), false);
    for (const { i, hit } of cells)
      map.FractureConductance[i] = Math.max(
        map.FractureConductance[i],
        round(p.ImpactFractureStrength * (1 - hit.distance / width))
      );
    map.faults.push({ id: `landmark:${placed.landmark.id}`, coordinates: placed.path, width });
  },
  measure(map, placed) {
    // Throw is the offset the fault's cells show across the scarp: the slope of elevation
    // against each cell's signed ramp, so a scarp narrower than a cell is still read from
    // whole cells and a correction applied through the same ramp reads back in full.
    const { width, cells } = scarpCells(map, placed),
      x = cells.map(({ hit }) => hit.side * clamp(hit.distance / (width / 2), 0, 1)),
      y = cells.map(({ i }) => map.Elevation[i]),
      mx = mean(x),
      my = mean(y);
    let covariance = 0,
      variance = 0;
    for (let k = 0; k < x.length; k++) {
      covariance += (x[k] - mx) * (y[k] - my);
      variance += (x[k] - mx) ** 2;
    }
    return { throw: variance > 0 ? (2 * covariance) / variance / 1024 : NaN };
  },
  maintain(map, p, placed, shortfall) {
    const needed = units(shortfall.throw ?? 0);
    if (needed <= 0) return 0;
    return throwScarp(map, p, placed, needed, true);
  },
};

export const landmarkKinds: Record<string, Kind> = {
  "volcanic-mountain": mountain(true),
  "resistant-mountain": mountain(false),
  canyon,
  "dome-ring": domeRing,
  "impact-ring": impactRing,
  escarpment,
  falls,
  ...magicLandmarkKinds,
};
