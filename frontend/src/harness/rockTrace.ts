import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { MapScale } from "@atlas/domain";
import { rockKindOfCode } from "../../../packages/generation/src/rock/rockCatalogue";
import { watchColumn } from "../../../packages/generation/src/rock/rockColumn";

/**
 * Why a world's rock is where it is. Step by step: how much rock each stripped, how many surfaces it
 * changed and into what, and what it did to how well neighbouring rock agrees. At the end, how rock,
 * stripping and building sort by distance from the converging boundaries, which is the pattern a
 * real orogen shows on a geological map. It reads the field and changes nothing.
 */
const isLand = (map: PhysicalField, i: number) =>
  map.mesh.membership(i) === 1 && map.Elevation.get(i) > map.EffectiveSeaLevel;
function neighboursAgree(map: PhysicalField) {
  let same = 0,
    pairs = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j <= i || !isLand(map, j)) continue;
      pairs++;
      if (map.RockKindCodes.get(i) === map.RockKindCodes.get(j)) same++;
    }
  }
  return pairs ? same / pairs : 0;
}
interface StepRecord {
  stripped: number;
  surfaces: number;
  agreement: number;
  changes: Map<string, number>;
  runs: number;
}
/** Cells' distance from a converging boundary, in cells' centre-to-centre steps. */
function stepsFromBoundary(map: PhysicalField) {
  const steps = new Int32Array(map.mesh.count).fill(-1),
    queue: number[] = [];
  for (let i = 0; i < map.mesh.count; i++)
    if (map.TectonicBoundaryCodes.get(i) === 1) {
      steps[i] = 0;
      queue.push(i);
    }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0 && steps[j] < 0) {
        steps[j] = steps[i] + 1;
        queue.push(j);
      }
    }
  }
  return steps;
}
const zoneNames = ["0-2 cells", "3-5", "6-9", "10-15", "16-25", "26+"];
const zoneOf = (steps: number) =>
  steps < 0
    ? 5
    : steps <= 2
      ? 0
      : steps <= 5
        ? 1
        : steps <= 9
          ? 2
          : steps <= 15
            ? 3
            : steps <= 25
              ? 4
              : 5;
function top(counts: Map<string, number>, total: number, take: number) {
  return Object.fromEntries(
    [...counts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, take)
      .map(([name, n]) => [name, Math.round((100 * n) / Math.max(1, total))])
  );
}
function median(values: number[]) {
  values.sort((a, b) => a - b);
  return Math.round(values[values.length >> 1] ?? 0);
}
/** Rock, stripping and height by distance from converging boundaries. */
function zones(map: PhysicalField, strippedHere: Float64Array) {
  const steps = stepsFromBoundary(map),
    kinds = zoneNames.map(() => new Map<string, number>()),
    stripped = zoneNames.map((): number[] => []),
    height = zoneNames.map((): number[] => []),
    cells = zoneNames.map(() => 0);
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    const zone = zoneOf(steps[i]),
      kind = rockKindOfCode(map.RockKindCodes.get(i)).id;
    cells[zone]++;
    kinds[zone].set(kind, (kinds[zone].get(kind) ?? 0) + 1);
    stripped[zone].push(MapScale.metres(strippedHere[i], "native"));
    height[zone].push(MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native"));
  }
  return zoneNames.map((name, zone) => ({
    zone: name,
    cells: cells[zone],
    strippedMedian: median(stripped[zone]),
    heightMedian: median(height[zone]),
    rock: top(kinds[zone], cells[zone], 5),
  }));
}
/**
 * Whether rock runs along tilted belts: in one thrust sheet, how often neighbours at the same place
 * across the sheet agree, against neighbours at different places across it. Banded rock agrees far
 * more along than across. A sheet's own frame, so it needs no guess at which way a belt runs.
 */
const tilted = (map: PhysicalField, i: number) => isLand(map, i) && map.ThrustDip.get(i) > 0;
/** Tallies one cell's neighbours in its own sheet, as along or across the sheet. */
function tallySheetPairs(map: PhysicalField, i: number, along: Tally, across: Tally) {
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j <= i || !tilted(map, j) || map.ThrustSheetIndex.get(j) !== map.ThrustSheetIndex.get(i))
      continue;
    const apart = Math.abs(map.ThrustAcross.get(i) - map.ThrustAcross.get(j)) / 1000,
      tally = apart < 0.1 ? along : apart > 0.25 ? across : null;
    if (!tally) continue;
    tally.pairs++;
    if (map.RockKindCodes.get(i) === map.RockKindCodes.get(j)) tally.same++;
  }
}
interface Tally {
  pairs: number;
  same: number;
}
function bands(map: PhysicalField) {
  const along = { pairs: 0, same: 0 },
    across = { pairs: 0, same: 0 };
  let cells = 0,
    metamorphic = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!tilted(map, i)) continue;
    cells++;
    if (rockKindOfCode(map.RockKindCodes.get(i)).family === "metamorphic") metamorphic++;
    tallySheetPairs(map, i, along, across);
  }
  const share = (hit: number, of: number) => Math.round((1000 * hit) / Math.max(1, of)) / 1000;
  return {
    tiltedCells: cells,
    along: share(along.same, along.pairs),
    across: share(across.same, across.pairs),
    metamorphic: share(metamorphic, cells),
  };
}
/** Starts watching; call `observe` after every step, and `read` at the end. */
export function rockTrace() {
  const records = new Map<string, StepRecord>();
  let stripped: Float64Array | null = null,
    previous: Float64Array | null = null,
    agreement = 0,
    strippedNow = 0;
  const stop = watchColumn({
    fold() {},
    strip(cell, amount) {
      strippedNow += MapScale.metres(amount, "native");
      if (stripped && cell < stripped.length) stripped[cell] += amount;
    },
  });
  return {
    observe(name: string, map: PhysicalField) {
      stripped ??= new Float64Array(map.mesh.count);
      const before = previous;
      previous = Float64Array.from({ length: map.mesh.count }, (_, i) => map.RockKindCodes.get(i));
      const now = neighboursAgree(map),
        record = records.get(name) ?? {
          stripped: 0,
          surfaces: 0,
          agreement: 0,
          changes: new Map<string, number>(),
          runs: 0,
        };
      record.runs++;
      record.stripped += strippedNow;
      strippedNow = 0;
      if (before) {
        record.agreement += now - agreement;
        for (let i = 0; i < map.mesh.count; i++) {
          if (before[i] === previous[i] || !isLand(map, i)) continue;
          record.surfaces++;
          const change = `${rockKindOfCode(before[i]).id}>${rockKindOfCode(previous[i]).id}`;
          record.changes.set(change, (record.changes.get(change) ?? 0) + 1);
        }
      }
      agreement = now;
      records.set(name, record);
    },
    read(map: PhysicalField | null) {
      stop();
      const steps = [...records]
        .filter(([, r]) => r.stripped > 0 || r.surfaces > 0)
        .sort((a, b) => b[1].surfaces - a[1].surfaces)
        .map(([name, r]) => ({
          name,
          runs: r.runs,
          strippedKm: Math.round(MapScale.inUnits(r.stripped, "km")),
          surfacesChanged: r.surfaces,
          agreementChange: Math.round(r.agreement * 1000) / 1000,
          changes: top(r.changes, r.surfaces, 6),
        }));
      return {
        steps,
        agreement: Math.round(agreement * 1000) / 1000,
        zones: map && stripped ? zones(map, stripped) : [],
        bands: map ? bands(map) : null,
      };
    },
  };
}
