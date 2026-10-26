// Authored landmarks: injected causes at an epoch and a maintained signature afterwards.
// Everything here writes the same quantities impacts, plumes and orogeny write; later
// passes act on landmark cells as on any other cell.
import { landmarkKind, type Landmark } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { placeLandmark, realizedAt, type Placed } from "./landmarkGeometry";
import { landmarkKinds } from "./landmarkKinds";
import type { LandmarkScene } from "./landmarkKind";
import { note, type LandmarkLedger, type LandmarkRecord } from "./landmarkLedger";

export type { LandmarkLedger, LandmarkRecord } from "./landmarkLedger";
export type { LandmarkScene } from "./landmarkKind";
export { placeLandmark, plateDriftSteps, realizedAt } from "./landmarkGeometry";
export { captureRiver } from "./landmarkCanyon";

const impactInvalidations = ["Lakes", "FlowRouting", "Rivers", "Validated", "DrainageConditioning"];
/** Products a landmark pass invalidates: the same ones an impact at that position invalidates. */
export const landmarkInvalidations = impactInvalidations.map((product) => `canonry:${product}`);

/** The guaranteed measures: catalogue parameters the kind measures back, advisory ones excluded. */
function targetMeasures(map: PhysicalField, placed: Placed, scene?: LandmarkScene) {
  const kind = landmarkKind(placed.landmark.kind)!,
    measured = new Set(
      Object.keys(landmarkKinds[kind.id]?.measure(map, placed, undefined, scene) ?? {})
    );
  return Object.fromEntries(
    kind.parameters
      .filter((p) => !p.advisory && measured.has(p.key))
      .map((p) => [p.key, placed.parameters[p.key]])
  );
}
export function landmarkRecord(
  map: PhysicalField,
  placed: Placed,
  scene?: LandmarkScene
): LandmarkRecord {
  return {
    id: placed.landmark.id,
    kind: placed.landmark.kind,
    realized: realizedAt(map, placed),
    emplacedAtEpoch: placed.landmark.emplacedAtEpoch,
    target: targetMeasures(map, placed, scene),
    measured: {},
    maintenance: 0,
    capture: null,
    corridor: [],
    notes: [],
  };
}
function recordFor(
  map: PhysicalField,
  placed: Placed,
  ledger: LandmarkLedger,
  scene?: LandmarkScene
) {
  map.landmarkLedger = ledger;
  const record = ledger.get(placed.landmark.id) ?? landmarkRecord(map, placed, scene);
  ledger.set(placed.landmark.id, record);
  return record;
}
/** Inject the landmark's causes at its epoch and record the event. */
export function emplaceLandmark(
  map: PhysicalField,
  p: PhysicalProfile,
  landmark: Landmark,
  epoch: number,
  ledger: LandmarkLedger,
  drift: number[] = [],
  scene?: LandmarkScene
) {
  const placed = placeLandmark(map, landmark, drift, epoch);
  if (!placed) return null;
  const record = recordFor(map, placed, ledger, scene),
    kind = landmarkKinds[landmark.kind];
  kind?.emplace(map, p, placed, epoch, record, scene);
  map.events.push({
    id: `landmark:${landmark.id}`,
    kind: "landmark",
    x: placed.center[0],
    y: placed.center[1],
    radius: landmarkKind(landmark.kind)!.reach(placed.parameters),
    epoch,
    strength: 1000,
  });
  kind?.capture?.(map, placed, record);
  record.measured = kind?.measure(map, placed, record, scene) ?? {};
  if (!record.realized)
    note(record, "Below this mesh's resolution: causes written at cell scale, signature latent.");
  return record;
}
/** Shortfalls of the guaranteed measures, in their units; empty when the signature holds. */
export function signatureShortfall(record: LandmarkRecord, measured: Record<string, number>) {
  const shortfall: Record<string, number> = {};
  for (const [key, target] of Object.entries(record.target)) {
    const value = measured[key];
    // A centimetre of slack keeps float arithmetic from reporting a met measure as short.
    if (!Number.isFinite(value) || value < target - 0.01) shortfall[key] = target - (value || 0);
  }
  return shortfall;
}
/** Measure the signature and apply the smallest correction that restores it. */
export function maintainLandmark(
  map: PhysicalField,
  p: PhysicalProfile,
  landmark: Landmark,
  epoch: number,
  ledger: LandmarkLedger,
  drift: number[] = [],
  scene?: LandmarkScene
) {
  const placed = placeLandmark(map, landmark, drift, epoch);
  if (!placed) return null;
  const record = recordFor(map, placed, ledger, scene),
    kind = landmarkKinds[landmark.kind];
  if (!kind) return record;
  const holds = record.realized || kind.holdsLatent === true;
  let corrected = 0;
  if (holds) corrected += kind.capture?.(map, placed, record) ?? 0;
  const shortfall = signatureShortfall(record, kind.measure(map, placed, record, scene));
  if (holds && Object.keys(shortfall).length)
    corrected += kind.maintain(map, p, placed, shortfall, epoch, record, scene) / 1024;
  record.maintenance += corrected;
  record.measured = kind.measure(map, placed, record, scene);
  return record;
}
/** Read the signature as it stands now, for the published record. */
export function remeasureLandmark(
  map: PhysicalField,
  landmark: Landmark,
  ledger: LandmarkLedger,
  scene?: LandmarkScene
) {
  const placed = placeLandmark(map, landmark),
    record = ledger.get(landmark.id),
    kind = landmarkKinds[landmark.kind];
  if (!placed || !record || !kind) return record;
  record.measured = kind.measure(map, placed, record, scene);
  return record;
}
