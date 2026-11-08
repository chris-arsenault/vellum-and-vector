import type { PhysicalField } from "../../../packages/generation/src/world/field";
import type { PhysicalContext } from "../../../packages/generation/src/world/context";
import { observeNativeSteps } from "../../../packages/generation/src/world/physicalSteps";
import { epochStory } from "./epochStory";
import { snapshotRecorder } from "./fieldSnapshot";
import { watchRockColumns } from "./reliefColumn";
import { reliefProbes } from "./reliefProbes";
import { rockTrace } from "./rockTrace";
import { MapScale, type Epoch } from "@atlas/domain";

/**
 * What each step of the world did to its relief: the height differences within a few cells after
 * every step, split into the ground's parts, so a loss of relief can be read back to its step.
 */
/** How far counts as local, in metres: a few cells of a draft world. */
const localMetres = 84_000;
const directions = 8;
const offsets = Array.from({ length: directions }, (_, k) => [
  Math.cos((k / directions) * 2 * Math.PI) * localMetres,
  Math.sin((k / directions) * 2 * Math.PI) * localMetres,
]);
function localRange(map: PhysicalField, values: { get(i: number): number }, cell: number) {
  let low = values.get(cell),
    high = low;
  for (const [dx, dy] of offsets) {
    const other = map.mesh.cellAt(map.mesh.x(cell) + dx, map.mesh.y(cell) + dy);
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
  const land: number[] = [];
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1 && map.Elevation.get(i) > map.EffectiveSeaLevel) land.push(i);
  return {
    name,
    epoch: context.EpochIndex,
    land: land.length,
    height: quantiles(
      land.map((i) => MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native"))
    ),
    range: quantiles(land.map((i) => localRange(map, map.Elevation, i))),
    support: quantiles(land.map((i) => localRange(map, map.CrustSupportElevation, i))),
    rockLoad: quantiles(land.map((i) => localRange(map, map.SurfaceRockLoad, i))),
  };
}
/** Starts recording; the returned function stops and hands back what was seen. */
export function traceRelief(snapshots?: { label: string; quality: string; epochs?: Epoch[] }) {
  const steps: ReturnType<typeof snapshot>[] = [],
    probes = reliefProbes(),
    record = snapshots && snapshotRecorder(snapshots.label, snapshots.quality, snapshots.epochs),
    stopColumns = watchRockColumns(),
    rock = rockTrace();
  let last: PhysicalField | null = null;
  observeNativeSteps((name, map, context) => {
    last = map;
    rock.observe(name, map);
    steps.push(snapshot(name, map, context));
    probes.observe(name, map, context);
    record?.(name, map, context);
  });
  return () => {
    observeNativeSteps(null);
    return {
      steps,
      probes: probes.read(),
      columns: stopColumns(last),
      rock: rock.read(last),
      story: last ? epochStory(last) : null,
    };
  };
}
