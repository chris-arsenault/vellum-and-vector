import type { WorkspaceChange, Bounds } from "@atlas/domain";

function affectsWindow(key: readonly unknown[], change: WorkspaceChange) {
  const windows = key[3] as Bounds[] | null | undefined;
  if (!windows || !change.extents.length) return true;
  return windows.some((window) =>
    change.extents.some(
      ({ bounds: b }) =>
        b[0] <= window[2] && b[2] >= window[0] && b[1] <= window[3] && b[3] >= window[1]
    )
  );
}
/** Metadata edits do not replace terrain sources; geographic changes touch visible windows. */
export function workspaceQueryAffected(key: readonly unknown[], change: WorkspaceChange) {
  if (key[0] === "worlds") return true;
  if (key[1] !== change.worldId) return false;
  const kinds = new Set(change.recordKinds ?? change.records.map((r) => r.kind));
  const geometryChanged = areaGeometryChanged(change);
  if (key[0] === "fields") {
    const fields = geometryChanged || fieldChange(change);
    return !!fields && affectsWindow(key, change);
  }
  if (key[0] === "scene") {
    const objects = ["feature", "representation", "magic", "landmark"] as const;
    return (
      (objects.some((kind) => kinds.has(kind)) || geometryChanged) && affectsWindow(key, change)
    );
  }
  return true;
}
function areaGeometryChanged(change: WorkspaceChange) {
  return (
    (change.recordKinds?.includes("area") ||
      change.records.some((record) => record.kind === "area")) &&
    (change.geometryExtents ?? change.extents).length > 0
  );
}
function fieldChange(change: WorkspaceChange) {
  return (
    change.resources.length > 0 ||
    change.layers?.includes("lakes") ||
    (change.recordKinds ?? change.records.map((record) => record.kind)).some(
      (kind) => kind === "field" || kind === "fieldPatch"
    )
  );
}
