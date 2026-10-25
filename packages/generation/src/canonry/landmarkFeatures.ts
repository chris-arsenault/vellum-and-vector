// Publication of authored landmarks: one feature per landmark identity, and no second row for
// the detected landform that is the landmark itself.
import { lineParts, spatial, type AtlasFeature, type Landmark } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import { putGenerated } from "../mapFeatures";
import { nearestTriangle } from "./mesh";
import { canyonCells } from "./landmarkCanyon";
import { distance, nearestOnPath, pathMetrics, placeLandmark } from "./landmarkGeometry";
import type { LandmarkRecord } from "./landmarkLedger";

type Work = NonNullable<GenerationState["physical"]>;

/** Metres around the landmark's geometry that its published footprint covers. */
function footprintReach(landmark: Landmark, work: Work) {
  const p = landmark.parameters;
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
/** The cells a landmark's signature occupies; a detected landform there is the landmark. */
function claimedCells(work: Work, landmark: Landmark, record: LandmarkRecord): number[] {
  const map = work.map,
    placed = placeLandmark(map, landmark);
  if (!placed) return [];
  const p = placed.parameters,
    within = (radius: number) => {
      const cells: number[] = [];
      for (let i = 0; i < map.mesh.count; i++)
        if (distance(map, i, placed.center) <= radius) cells.push(i);
      return cells;
    };
  switch (landmark.kind) {
    case "volcanic-mountain":
    case "resistant-mountain":
      return within(Math.max(p.baseRadius * 500, map.mesh.spacing));
    case "canyon":
      return canyonCells(map, placed, record.corridor).floor.map((cell) => cell.i);
    case "dome-ring":
      return within((p.diameter * 1000) / 2);
    case "impact-ring":
      return within((p.diameter * 1000) / 2 + Math.max(p.diameter * 170, map.mesh.spacing));
    case "escarpment": {
      const metrics = pathMetrics(map, placed.path),
        cells: number[] = [];
      for (let i = 0; i < map.mesh.count; i++)
        if (
          nearestOnPath(map, metrics, map.mesh.x[i], map.mesh.y[i]).distance <=
          p.scarpWidth * 1000
        )
          cells.push(i);
      return cells;
    }
    default:
      return within(map.mesh.spacing);
  }
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
/** The landmark as geography that exists: its authored identity with the measured signature. */
export function extractLandmarks(state: GenerationState) {
  const work = state.physical!,
    world = state.domain.world,
    [x0, y0] = work.map.mesh.origin,
    footprint = state.domain.scope.footprint;
  for (const [landmark, record] of landmarkPairs(state)) {
    if (!spatial.intersects(landmark.geometry, footprint)) continue;
    const reach = footprintReach(landmark, work),
      shape = spatial.buffer(landmark.geometry, reach),
      clipped = shape && spatial.intersection(shape, footprint);
    const capture = record.capture
      ? {
          x: Math.round(record.capture.x + x0),
          y: Math.round(record.capture.y + y0),
          accumulation: record.capture.accumulation,
        }
      : null;
    const feature: AtlasFeature = {
      id: landmark.id,
      areaId: state.domain.scope.areaId,
      layerId: "geology",
      kind: "landmark",
      name: landmark.name,
      geometry: landmark.geometry,
      ...(clipped ? { footprint: clipped } : {}),
      detail: {},
      attributes: {
        sourceAlgorithm: "atlas-landmarks-1",
        causeId: `landmark:${landmark.id}`,
        nameStatus: "proper",
        landmarkKind: landmark.kind,
        emplacedAtEpoch: record.emplacedAtEpoch,
        signature: record.realized ? "realized" : "latent",
        ...signatureAttributes(record),
        maintenance: Math.round(record.maintenance * 10) / 10,
        capture,
        captureAccumulation: capture ? Math.round(capture.accumulation) : null,
        notes: record.notes.join(" "),
      },
      relations: [],
      state: "generated",
      protected: false,
      actor: "generator",
      generationId: null,
      generationDomain: world.layers.geology?.generator ?? null,
      causes: [
        `Formed in epoch ${record.emplacedAtEpoch + 1} from the authored landmark ${landmark.name}; its signature was held through every later epoch.`,
      ],
    };
    putGenerated(state, feature);
  }
}
