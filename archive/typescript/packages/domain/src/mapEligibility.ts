import type { Geometry } from "geojson";
import type { AtlasFeature, Representation, World } from "./model";
import type { DomainSnapshot } from "./operations";
import { areaSpace } from "./composition";
import { presentAtlasFeature } from "./featureReads";
import { spatial } from "./spatial";
import { sameValue } from "./values";
import type { Diagnostic } from "./errors";

export interface MappedDrawing {
  mapOnly?: boolean;
  mapSource?: Representation;
  mapBaseline?: Pick<AtlasFeature, "geometry" | "footprint" | "attributes" | "relations">;
}

/** Retain the replaced fine representation and the drawing before its first edit. */
export function mappedBaseline(world: World, feature: AtlasFeature, areaId: string) {
  const previous = feature.detail[areaId];
  if (previous?.mapOnly)
    return { mapSource: previous.mapSource, mapBaseline: previous.mapBaseline };
  const before = presentAtlasFeature(world, feature, areaId)!,
    footprint =
      before.footprint && spatial.intersection(before.footprint, world.areas[areaId].footprint);
  return {
    ...(previous ? { mapSource: structuredClone(previous) } : {}),
    mapBaseline: {
      geometry: spatial.intersection(before.geometry, world.areas[areaId].footprint)!,
      attributes: structuredClone(before.attributes),
      relations: structuredClone(before.relations),
      ...(footprint ? { footprint } : {}),
    },
  };
}

// Cartographic styles are stored in views/layers; these attributes concern naming only.
const namingAttributes = new Set(["nameStatus", "naming", "nameSource", "nameMeaning"]);
function structuralAttributes(attributes: Record<string, unknown> | null) {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(([key]) => !namingAttributes.has(key))
  );
}
export function hasStructuralMapEdit(detail: Representation, feature: AtlasFeature) {
  const before = detail.mapBaseline;
  return (
    !before ||
    detail.state === "intentionallyEmpty" ||
    !sameValue(before.geometry, detail.geometry) ||
    !sameValue(before.footprint, detail.footprint) ||
    !sameValue(before.relations, feature.relations) ||
    !sameValue(structuralAttributes(before.attributes), structuralAttributes(detail.attributes))
  );
}
function editedGeometry(detail: Representation, feature: AtlasFeature): Geometry[] {
  if (!hasStructuralMapEdit(detail, feature)) return [];
  const before = detail.mapBaseline;
  return [before?.geometry, before?.footprint, detail.geometry, detail.footprint].filter(
    (geometry): geometry is Geometry => !!geometry
  );
}

/** Cosmetic overrides follow fresh geography rather than pinning an obsolete drawing. */
export function refreshMappedPresentation(
  world: World,
  feature: AtlasFeature,
  areaId: string,
  detail: Representation
): Representation {
  const retained = mappedBaseline(world, feature, areaId),
    baseline = retained.mapBaseline!;
  const attributes = { ...baseline.attributes };
  for (const key of namingAttributes) {
    const value = detail.attributes?.[key];
    if (sameValue(detail.mapBaseline!.attributes[key], value)) continue;
    if (value === undefined) delete attributes[key];
    else attributes[key] = structuredClone(value);
  }
  return {
    ...structuredClone(detail),
    ...retained,
    geometry: baseline.geometry,
    footprint: baseline.footprint,
    attributes,
  };
}

export interface MappedGenerationConflict {
  subjectId: string;
  areaId: string;
  name: string;
}

function featureEdits(feature: AtlasFeature) {
  const edits: { areaId: string; geometries: Geometry[] }[] = [];
  const own = feature.detail[feature.areaId];
  if (feature.mapOnly && !own)
    edits.push({ areaId: feature.areaId, geometries: featureGeometry(feature) });
  for (const [areaId, detail] of Object.entries(feature.detail)) {
    if (!detail.mapOnly) continue;
    const geometries = feature.mapOnly
      ? detail.state === "intentionallyEmpty"
        ? []
        : featureGeometry(detail)
      : editedGeometry(detail, feature);
    edits.push({ areaId, geometries });
  }
  return edits;
}
function featureGeometry(feature: Pick<AtlasFeature, "geometry" | "footprint">) {
  return feature.footprint ? [feature.geometry, feature.footprint] : [feature.geometry];
}

/** Any overlapping drawing in this located space must survive, regardless of hierarchy depth. */
export function mappedGenerationConflicts(
  snapshot: DomainSnapshot,
  areaId: string,
  features: Iterable<AtlasFeature> = Object.values(snapshot.world.features)
) {
  const { world } = snapshot,
    area = world.areas[areaId];
  if (!area || !["world", "region"].includes(area.profile)) return [];
  const space = areaSpace(world, areaId),
    conflicts: MappedGenerationConflict[] = [];
  const add = (subjectId: string, owner: string, name: string, geometries: Geometry[]) => {
    if (areaSpace(world, owner) !== space) return;
    if (!geometries.some((geometry) => spatial.intersects(area.footprint, geometry))) return;
    if (!conflicts.some((item) => item.subjectId === subjectId && item.areaId === owner))
      conflicts.push({ subjectId, areaId: owner, name });
  };
  for (const feature of features)
    for (const edit of featureEdits(feature))
      add(feature.id, edit.areaId, feature.name, edit.geometries);
  for (const patch of snapshot.fieldPatches)
    if (patch.mapOnly)
      add(patch.id, patch.areaId, `${patch.channels.join(", ")} painting`, [patch.footprint]);
  return conflicts;
}

export function mappedGenerationDiagnostics(
  snapshot: DomainSnapshot,
  areaId: string,
  features?: Iterable<AtlasFeature>
): Diagnostic[] {
  return mappedGenerationConflicts(snapshot, areaId, features).map((edit) => ({
    code: "mapped_edit_overlap",
    severity: "error",
    invocation: null,
    resource: edit.subjectId,
    message: `This generation overlaps “${edit.name}” edited on “${snapshot.world.areas[edit.areaId].name}”. Choose an untouched region or undo the structural edit. Names and styles do not restrict refinement.`,
  }));
}
