import type { PhysicalField } from "./field";
import type { TransportPlan } from "./transportPlan";
import { physicalSampler } from "./physicalMetric";
import { meshPoint } from "./mesh";
import type { prepareAdaptiveTransfer } from "@atlas/domain";

/** Corridor indices are moving material, not permanent locations in a mesh. */
export function advectLandmarkDrainage(map: PhysicalField, plan: TransportPlan, distance: number) {
  if (!map.landmarkLedger?.size) return;
  const vx = physicalSampler(map.mesh, map.CrustMotionX),
    vy = physicalSampler(map.mesh, map.CrustMotionY);
  for (const record of map.landmarkLedger.values()) {
    const previous = new Set(record.corridor);
    record.corridor = [];
    for (let i = 0; i < plan.dominant.length; i++)
      if (previous.has(plan.dominant.get(i))) record.corridor.push(i);
    const capture = record.capture;
    if (!capture) continue;
    [capture.x, capture.y] = meshPoint(
      map.mesh,
      capture.x + (vx(capture.x, capture.y) * distance) / 1000,
      capture.y + (vy(capture.x, capture.y) * distance) / 1000
    );
  }
}

export function remeshLandmarkDrainage(
  previous: PhysicalField,
  next: PhysicalField,
  transfer: ReturnType<typeof prepareAdaptiveTransfer>
) {
  for (const record of next.landmarkLedger?.values() ?? []) {
    const source = new Set(record.corridor.map((cell) => previous.mesh.cellToLeaf(cell)));
    const moved = transfer((leaf) => Number(source.has(leaf)), "category");
    record.corridor = [];
    for (let cell = 0; cell < next.mesh.count; cell++)
      if (moved.get(next.mesh.cellToLeaf(cell)) === 1) record.corridor.push(cell);
    moved.release();
    if (record.capture) {
      record.capture.x += previous.mesh.origin[0] - next.mesh.origin[0];
      record.capture.y += previous.mesh.origin[1] - next.mesh.origin[1];
    }
  }
}
