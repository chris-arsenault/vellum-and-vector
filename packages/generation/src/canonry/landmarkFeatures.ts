// Publication of authored landmarks: one feature per landmark identity, and no second row for
// the detected landform that is the landmark itself.
import {
  landmarkKind,
  landmarkLayer,
  lineParts,
  spatial,
  type AtlasFeature,
  type Landmark,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { putGenerated } from "../mapFeatures";
import { atlasName, nameGeographicFeature, nameMetadata } from "../atlasNaming";
import { remeasureLandmark, type LandmarkScene } from "./landmarks";
import { nearestTriangle } from "./mesh";
import { canyonCells } from "./landmarkCanyon";
import { distance, nearestOnPath, pathMetrics, placeLandmark } from "./landmarkGeometry";
import type { LandmarkRecord } from "./landmarkLedger";

type Work = NonNullable<GenerationState["physical"]>;

/** Metres around the landmark's geometry that its published footprint covers. */
function footprintReach(landmark: Landmark, work: Work) {
  const p = landmark.parameters;
  if (landmarkKind(landmark.kind)?.system) return p.reach * 1000;
  switch (landmark.kind) {
    case "volcanic-mountain":
    case "resistant-mountain":
      return p.baseRadius * 1000;
    case "canyon":
      return Math.max((p.rimWidth * 1000) / 2, work.map.mesh.spacing * 0.6);
    case "dome-ring":
    case "impact-ring":
      return (p.diameter * 1000) / 2;
    case "escarpment":
      return p.scarpWidth * 1000;
    default:
      return work.map.mesh.spacing;
  }
}
/** The radius a point kind's signature claims around its anchor, or null for a line kind. */
function claimRadius(kind: string, p: Record<string, number>, spacing: number) {
  switch (kind) {
    case "volcanic-mountain":
    case "resistant-mountain":
      return Math.max(p.baseRadius * 500, spacing);
    case "dome-ring":
      return (p.diameter * 1000) / 2;
    case "impact-ring":
      return (p.diameter * 1000) / 2 + Math.max(p.diameter * 170, spacing);
    case "canyon":
    case "escarpment":
      return null;
    default:
      return spacing;
  }
}
/** The cells a landmark's signature occupies; a detected landform there is the landmark. */
function claimedCells(work: Work, landmark: Landmark, record: LandmarkRecord): number[] {
  const map = work.map,
    placed = placeLandmark(map, landmark);
  // A magic source claims no landform: the places its system makes around it are its own.
  if (!placed || landmarkKind(landmark.kind)?.system) return [];
  const p = placed.parameters,
    radius = claimRadius(landmark.kind, p, map.mesh.spacing),
    cells: number[] = [];
  if (landmark.kind === "canyon")
    return canyonCells(map, placed, record.corridor).floor.map((cell) => cell.i);
  const metrics = pathMetrics(map, placed.path);
  for (let i = 0; i < map.mesh.count; i++) {
    const inside =
      radius === null
        ? nearestOnPath(map, metrics, map.mesh.x[i], map.mesh.y[i]).distance <= p.scarpWidth * 1000
        : distance(map, i, placed.center) <= radius;
    if (inside) cells.push(i);
  }
  return cells;
}
function landmarkPairs(state: GenerationState) {
  const work = state.physical!,
    pairs: [Landmark, LandmarkRecord][] = [];
  for (const [id, record] of work.landmarks ?? []) {
    const landmark = state.domain.world.landmarks.find((item) => item.id === id);
    if (landmark) pairs.push([landmark, record]);
  }
  return pairs;
}
export function landmarkClaims(state: GenerationState) {
  const work = state.physical!,
    claimed = new Set<number>();
  for (const [landmark, record] of landmarkPairs(state))
    for (const i of claimedCells(work, landmark, record)) claimed.add(i);
  return claimed;
}
function cellOf(work: Work, [x, y]: number[]) {
  const cell = nearestTriangle(
    work.map.mesh,
    x - work.map.mesh.origin[0],
    y - work.map.mesh.origin[1]
  );
  return cell === undefined ? -1 : cell;
}
/** Coordinates that locate a detected landform: its anchor when it has one, else its geometry. */
function anchors(feature: AtlasFeature): number[][] {
  const representative = feature.attributes.representative as { x: number; y: number } | undefined;
  if (representative && Number.isFinite(representative.x))
    return [[representative.x, representative.y]];
  const geometry: Geometry = feature.geometry;
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type.includes("Polygon")) {
    const [w, s, e, n] = spatial.bounds(geometry);
    return [[(w + e) / 2, (s + n) / 2]];
  }
  return lineParts(geometry).flat();
}
const detectedKinds = new Set(["peak", "gorge", "waterfall", "valley"]);
/** Drop detected landforms that stand on claimed cells: they are the landmark, published once. */
export function dropClaimedFeatures(state: GenerationState, claimed: Set<number>) {
  if (!claimed.size) return;
  const work = state.physical!,
    world = state.domain.world;
  for (const feature of Object.values(world.features)) {
    if (
      feature.areaId !== state.domain.scope.areaId ||
      feature.state !== "generated" ||
      feature.layerId !== "geology" ||
      !detectedKinds.has(feature.kind)
    )
      continue;
    const points = anchors(feature),
      onClaim = points.filter((p) => claimed.has(cellOf(work, p))).length;
    if (onClaim * 2 >= points.length) delete world.features[feature.id];
  }
}
function signatureAttributes(record: LandmarkRecord) {
  const attributes: Record<string, unknown> = {};
  for (const [key, target] of Object.entries(record.target)) {
    const measured = record.measured[key];
    attributes[key] = Number.isFinite(measured) ? Math.round(measured * 10) / 10 : null;
    attributes[`${key}Target`] = target;
  }
  return attributes;
}
/** The landform the naming vocabulary knows each kind as. */
const landformKinds: Record<string, string> = {
  "volcanic-mountain": "volcano",
  "resistant-mountain": "peak",
  canyon: "gorge",
  "dome-ring": "dome",
  "impact-ring": "crater",
  escarpment: "escarpment",
  falls: "waterfall",
};
/** A landmark the generator sited is named once, here, and keeps that name on every rerun. */
function nameLandmark(state: GenerationState, landmark: Landmark) {
  if (landmark.name) return {};
  const kind = landmarkKind(landmark.kind),
    [w, s, e, n] = spatial.bounds(landmark.geometry);
  const named = kind?.system
    ? atlasName(state.domain.world, {
        key: landmark.id,
        kind: "magic",
        subkind: kind.id,
        term: kind.term,
        position: { x: (w + e) / 2, y: (s + n) / 2 },
      })
    : nameGeographicFeature(
        state.domain.world,
        landmark.id,
        landformKinds[landmark.kind] ?? "peak",
        landmark.geometry,
        {}
      );
  if (!named) return {};
  landmark.name = named.name;
  return nameMetadata(named);
}
/** What a magic landmark publishes beyond the shared signature: its system and source. */
function magicAttributes(landmark: Landmark, record: LandmarkRecord) {
  const kind = landmarkKind(landmark.kind);
  return kind?.system ? { system: kind.system, sourceStrength: record.strength ?? null } : {};
}
/** The captured river in world coordinates, with the flow it brought. */
function captureAttributes(record: LandmarkRecord, [x0, y0]: [number, number]) {
  if (!record.capture) return { capture: null, captureAccumulation: null };
  return {
    capture: {
      x: Math.round(record.capture.x + x0),
      y: Math.round(record.capture.y + y0),
      accumulation: record.capture.accumulation,
    },
    captureAccumulation: Math.round(record.capture.accumulation),
  };
}
function landmarkFeature(
  state: GenerationState,
  landmark: Landmark,
  record: LandmarkRecord
): AtlasFeature {
  const work = state.physical!,
    footprint = state.domain.scope.footprint,
    naming = nameLandmark(state, landmark),
    shape = spatial.buffer(landmark.geometry, footprintReach(landmark, work)),
    clipped = shape && spatial.intersection(shape, footprint),
    generated = landmark.origin === "generated",
    layerId = landmarkLayer(landmarkKind(landmark.kind));
  return {
    id: landmark.id,
    areaId: state.domain.scope.areaId,
    layerId,
    kind: "landmark",
    name: landmark.name,
    geometry: landmark.geometry,
    ...(clipped ? { footprint: clipped } : {}),
    detail: {},
    attributes: {
      sourceAlgorithm: "atlas-landmarks-1",
      causeId: `landmark:${landmark.id}`,
      nameStatus: "proper",
      ...naming,
      landmarkKind: landmark.kind,
      origin: generated ? "generated" : "authored",
      emplacedAtEpoch: record.emplacedAtEpoch,
      signature: record.realized ? "realized" : "latent",
      ...signatureAttributes(record),
      ...magicAttributes(landmark, record),
      maintenance: Math.round(record.maintenance * 10) / 10,
      ...captureAttributes(record, work.map.mesh.origin),
      notes: record.notes.join(" "),
    },
    relations: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    generationDomain: state.domain.world.layers[layerId]?.generator ?? null,
    causes: [
      `${generated ? "Sited by the generator and formed" : "Formed from the authored landmark"} in epoch ${record.emplacedAtEpoch + 1}; its signature was held through every later epoch.`,
    ],
  };
}
/**
 * The landmark as geography that exists: its identity with the signature as it stands at
 * present, read again here because the present phase re-forms ice, water and magic.
 */
export function extractLandmarks(state: GenerationState) {
  const work = state.physical!,
    footprint = state.domain.scope.footprint,
    scene: LandmarkScene = {
      world: state.domain.world,
      magic: work.magic,
      scope: { areaId: state.domain.scope.areaId, spaceId: state.domain.scope.spaceId },
      activity: () => 1,
    };
  for (const [landmark, record] of landmarkPairs(state)) {
    if (!spatial.intersects(landmark.geometry, footprint)) continue;
    remeasureLandmark(work.map, landmark, work.landmarks!, scene);
    putGenerated(state, landmarkFeature(state, landmark, record));
  }
}
