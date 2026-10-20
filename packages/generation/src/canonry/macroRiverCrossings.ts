import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { crossingReaches } from "./macroNetwork";
import { roundStructuralProfile } from "./macroCurves";

type Curve = { points: [number, number][]; positions: number[] };

function junctionShifts(
  work: AtlasPhysicalWorkspace,
  reaches: number[][],
  curves: Curve[],
  bad: Set<number>,
  fraction: number
) {
  const mesh = work.map.mesh,
    shifts = new Map<number, [number, number]>();
  for (const r of bad)
    for (const n of [0, curves[r].points.length - 1]) {
      const cell = n === 0 ? reaches[r][0] : reaches[r].at(-1)!,
        point = curves[r].points[n];
      shifts.set(cell, [
        (mesh.x[cell] - point[0]) * fraction,
        (mesh.y[cell] - point[1]) * fraction,
      ]);
    }
  return shifts;
}

/** Resolve local conflicts without retracting unrelated drainage networks. */
export function correctRiverCrossings(
  work: AtlasPhysicalWorkspace,
  reaches: number[][],
  curves: Curve[]
) {
  const mesh = work.map.mesh;
  for (let attempt = 0; attempt < 9; attempt++) {
    const bad = crossingReaches(curves, Math.max(1000, mesh.spacing * 2));
    if (!bad.size) return;
    const fraction = attempt === 8 ? 1 : 0.5,
      shifts = junctionShifts(work, reaches, curves, bad, fraction);
    for (const [r, curve] of curves.entries()) {
      const members = reaches[r],
        first = shifts.get(members[0]) ?? [0, 0],
        last = shifts.get(members.at(-1)!) ?? [0, 0],
        start = curve.points[0],
        end = curve.points.at(-1)!,
        startOffset = [
          start[0] + first[0] - mesh.x[members[0]],
          start[1] + first[1] - mesh.y[members[0]],
        ],
        endOffset = [
          end[0] + last[0] - mesh.x[members.at(-1)!],
          end[1] + last[1] - mesh.y[members.at(-1)!],
        ];
      for (let n = 0; n < curve.points.length; n++) {
        const position = curve.positions[n],
          at = Math.min(members.length - 2, Math.floor(position)),
          t = position - at,
          u = n / (curve.points.length - 1),
          a = members[at],
          b = members[at + 1],
          point = curve.points[n],
          shifted: [number, number] = [
            point[0] + first[0] * (1 - u) ** 3 + last[0] * u ** 3,
            point[1] + first[1] * (1 - u) ** 3 + last[1] * u ** 3,
          ];
        curve.points[n] = bad.has(r)
          ? (shifted.map((value, axis) => {
              const coordinates = axis === 0 ? mesh.x : mesh.y,
                original =
                  coordinates[a] * (1 - t) +
                  coordinates[b] * t +
                  startOffset[axis] * (1 - u) ** 3 +
                  endOffset[axis] * u ** 3;
              return value * (1 - fraction) + original * fraction;
            }) as [number, number])
          : shifted;
      }
    }
  }
  restoreConflictingRoutes(work, reaches, curves);
}

function restoreConflictingRoutes(
  work: AtlasPhysicalWorkspace,
  reaches: number[][],
  curves: Curve[]
) {
  const mesh = work.map.mesh,
    restored = new Set<number>();
  for (;;) {
    const bad = crossingReaches(curves, Math.max(1000, mesh.spacing * 2));
    if (!bad.size) {
      roundRestoredRoutes(work, curves, restored);
      return;
    }
    if ([...bad].every((r) => restored.has(r)))
      throw new Error("The source drainage graph contains crossing river routes.");
    const shifts = junctionShifts(work, reaches, curves, bad, 1);
    for (const [r, curve] of curves.entries()) {
      if (bad.has(r)) {
        // Include every original corner. Sampling across a missing corner can
        // cut across another reach even at zero displacement.
        curve.points = reaches[r].map((i) => [mesh.x[i], mesh.y[i]]);
        curve.positions = reaches[r].map((_, n) => n);
        restored.add(r);
      } else {
        const first = shifts.get(reaches[r][0]) ?? [0, 0],
          last = shifts.get(reaches[r].at(-1)!) ?? [0, 0];
        curve.points = curve.points.map(([x, y], n) => {
          const t = n / (curve.points.length - 1);
          return [
            x + first[0] * (1 - t) ** 3 + last[0] * t ** 3,
            y + first[1] * (1 - t) ** 3 + last[1] * t ** 3,
          ];
        });
      }
    }
  }
}

function roundRestoredRoutes(work: AtlasPhysicalWorkspace, curves: Curve[], restored: Set<number>) {
  const original = new Map<number, Curve>();
  for (const r of restored) {
    const curve = curves[r];
    if (curve.points.length < 3) continue;
    original.set(r, { points: curve.points, positions: curve.positions });
    const rounded = roundStructuralProfile(
      {
        id: "river",
        points: curve.points,
        widths: curve.points.map(() => 1),
        values: { position: curve.positions },
        operation: "replace",
      },
      work.profile.RidgeWidth * 0.2
    );
    curve.points = rounded.points;
    curve.positions = rounded.values.position;
  }
  for (;;) {
    const bad = crossingReaches(curves, Math.max(1000, work.map.mesh.spacing * 2));
    if (!bad.size) return;
    for (const r of bad) {
      const source = original.get(r);
      if (source) {
        Object.assign(curves[r], source);
        original.delete(r);
      }
    }
  }
}
