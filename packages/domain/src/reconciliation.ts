import type { Area, World, LocatedRepresentation } from "./model";
import type { DomainSnapshot, ChangeSet } from "./operations";
import { areaSpace, isDescendant } from "./composition";
import { establishBoundary, validateCrossings } from "./boundaryContracts";
import { sameValue } from "./values";
import { representationId } from "./identity";
import { upsertArea } from "./authoringBasics";

function parentContext(world: World, child: Area): World {
  const features = Object.fromEntries(
    Object.values(world.features).map((f) => [
      f.id,
      {
        ...f,
        detail: Object.fromEntries(
          Object.entries(f.detail).filter(([id]) => !isDescendant(world.areas, id, child.id))
        ),
      },
    ])
  );
  return { ...world, features };
}
function crossingShape(area: Area, features: Set<string>) {
  return (area.boundary?.crossings ?? [])
    .filter((c) => features.has(c.featureId))
    .map((c) => ({
      featureId: c.featureId,
      point: c.point,
      direction: c.direction ?? "undirected",
      flow: c.flowKnown === false ? null : c.flow,
      elevation: c.elevationKnown === false ? null : c.elevation,
    }))
    .sort(
      (a, b) =>
        a.featureId.localeCompare(b.featureId) || a.point.x - b.point.x || a.point.y - b.point.y
    );
}
export function reconcileFeatureContracts(
  snapshot: DomainSnapshot,
  candidate: World,
  changes: ChangeSet,
  features: string[],
  ownerArea: string
): void {
  const ids = new Set(features);
  for (const area of Object.values(candidate.areas)) {
    if (
      !area.boundary ||
      area.id === ownerArea ||
      !isDescendant(candidate.areas, area.id, ownerArea)
    )
      continue;
    if (areaSpace(candidate, area.id) !== snapshot.scope.spaceId) continue;
    const parent = parentContext(candidate, area),
      computed = establishBoundary({ ...snapshot, world: parent }, area);
    const updated: Area = {
      ...area,
      boundary: {
        ...area.boundary,
        version: area.boundary.version + 1,
        parentVersion: candidate.version,
        crossings: [
          ...area.boundary.crossings.filter((c) => !ids.has(c.featureId)),
          ...computed.crossings.filter((c) => ids.has(c.featureId)),
        ],
      },
    };
    if (sameValue(crossingShape(area, ids), crossingShape(updated, ids))) continue;
    markDetails(snapshot, candidate, updated, changes, ids);
    upsertArea(changes, updated);
    candidate.areas[area.id] = updated;
  }
}
function markDetails(
  snapshot: DomainSnapshot,
  world: World,
  area: Area,
  changes: ChangeSet,
  features: Set<string>
) {
  for (const id of features) {
    const source = world.features[id];
    if (!source) continue;
    const detail = source.detail[area.id];
    if (!detail) continue;
    const explicit = changes.writes.find(
      (w) => w.kind === "representation" && w.value.featureId === id && w.value.areaId === area.id
    );
    if (explicit?.kind === "representation") {
      validateCrossings(
        { ...snapshot, world },
        area,
        source,
        explicit.value.geometry,
        explicit.value.attributes ?? source.attributes
      );
      continue;
    }
    const value: LocatedRepresentation = {
      ...detail,
      id: detail.id ?? representationId(world.id, id, area.id),
      featureId: id,
      areaId: area.id,
      needsReconciliation: true,
    };
    changes.writes.push({ kind: "representation", value });
    source.detail[area.id] = value;
    if (area.layers[source.layerId] === "generated")
      area.layers = { ...area.layers, [source.layerId]: "stale" };
  }
}
