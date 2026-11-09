import type { PhysicalField } from "../../../packages/generation/src/world/field";
import type { PhysicalContext } from "../../../packages/generation/src/world/context";
import { observeNativeSteps } from "../../../packages/generation/src/world/physicalSteps";
import { epochStory } from "./epochStory";
import { captureFailedField, snapshotRecorder } from "./fieldSnapshot";
import { watchRockColumns } from "./reliefColumn";
import { reliefProbes } from "./reliefProbes";
import { rockTrace } from "./rockTrace";
import { MapScale, type Epoch } from "@atlas/domain";

/**
 * What each step of the world did to its relief: the height differences within a few cells after
 * every outer step, split into the ground's parts, so a loss of relief can be read back to its step.
 * Embedded deformation is included in its enclosing plate step; material event watchers stay active.
 */
/** Local relief span: 84 km on the reference map. */
const localSpan = 0.021;
const directions = 8;
const offsets = Array.from({ length: directions }, (_, k) => [
  Math.cos((k / directions) * 2 * Math.PI),
  Math.sin((k / directions) * 2 * Math.PI),
]);
function localRange(
  map: PhysicalField,
  values: { get(i: number): number },
  cell: number,
  radius: number
) {
  let low = values.get(cell),
    high = low;
  for (const [dx, dy] of offsets) {
    const other = map.mesh.cellAt(map.mesh.x(cell) + dx * radius, map.mesh.y(cell) + dy * radius);
    if (other < 0) continue;
    const value = values.get(other);
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return MapScale.metres(high - low, "native");
}
function quantiles(values: number[]) {
  values.sort((a, b) => a - b);
  const at = (q: number) => Math.round(values[Math.floor(q * (values.length - 1))] ?? 0);
  return [at(0.5), at(0.9), at(0.99)];
}
function snapshot(name: string, map: PhysicalField, context: PhysicalContext) {
  const radius = map.scale.length(localSpan),
    land: number[] = [];
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1 && map.Elevation.get(i) > map.EffectiveSeaLevel) land.push(i);
  return {
    name,
    epoch: context.EpochIndex,
    land: land.length,
    localMetres: radius,
    height: quantiles(
      land.map((i) => MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native"))
    ),
    range: quantiles(land.map((i) => localRange(map, map.Elevation, i, radius))),
    support: quantiles(land.map((i) => localRange(map, map.CrustSupportElevation, i, radius))),
    rockLoad: quantiles(land.map((i) => localRange(map, map.SurfaceRockLoad, i, radius))),
  };
}
type ObservedField = { map: PhysicalField; context: PhysicalContext; name: string };
/** Starts recording; the returned function stops and hands back what was seen. */
export function traceRelief(snapshots?: {
  label: string;
  quality: string;
  seed: number;
  epochs: Epoch[];
}) {
  const steps: ReturnType<typeof snapshot>[] = [],
    probes = reliefProbes(),
    record = snapshots && snapshotRecorder(snapshots.label, snapshots.quality, snapshots.epochs),
    stopColumns = watchRockColumns(),
    rock = rockTrace(),
    monitoring = {
      granularity: "outer-native-steps" as const,
      observedSteps: 0,
      embeddedStepsSkipped: 0,
      snapshotsWritten: 0,
      // Completed-step diagnostics only; live material hooks remain part of process time.
      observerMilliseconds: 0,
      snapshotMilliseconds: 0,
      finalizationMilliseconds: 0,
    };
  let last: ObservedField | null = null;
  observeNativeSteps((name, map, context, { depth }) => {
    last = { map, context, name };
    if (depth > 0) {
      monitoring.embeddedStepsSkipped++;
      return;
    }
    const observed = performance.now();
    try {
      rock.observe(name, map);
      steps.push(snapshot(name, map, context));
      probes.observe(name, map, context);
      monitoring.observedSteps++;
    } finally {
      monitoring.observerMilliseconds += performance.now() - observed;
    }
    if (record) {
      const captured = performance.now();
      try {
        if (record(name, map, context)) monitoring.snapshotsWritten++;
      } finally {
        monitoring.snapshotMilliseconds += performance.now() - captured;
      }
    }
  });
  return (failure?: string) => {
    observeNativeSteps(null);
    let failedSnapshot: string | undefined;
    if (failure !== undefined && snapshots && last) {
      const captured = performance.now();
      try {
        failedSnapshot = captureFailedField(snapshots, last.map, last.context, {
          status: "failed",
          message: failure,
          lastObservedStep: last.name,
          lastObservedEpoch: last.context.EpochIndex,
        });
      } finally {
        monitoring.snapshotMilliseconds += performance.now() - captured;
      }
    }
    const started = performance.now(),
      result = {
        steps,
        probes: probes.read(),
        columns: stopColumns(last?.map ?? null),
        rock: rock.read(last?.map ?? null),
        story: last ? epochStory(last.map) : null,
      };
    monitoring.finalizationMilliseconds += performance.now() - started;
    return { ...result, monitoring, failedSnapshot };
  };
}
