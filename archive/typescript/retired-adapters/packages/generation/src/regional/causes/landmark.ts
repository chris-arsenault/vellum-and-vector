import { landmarkKind, MapScale } from "@atlas/domain";
import { nearestOnPath, pathMetrics, type Placed } from "../../world/landmarkGeometry";
import { maintainLandmark, placeLandmark, type LandmarkLedger } from "../../world/landmarks";
import { distance, isContent, regionalSpan } from "../lattice";
import { repel } from "../network";
import type { Evidence, RegionalState } from "../state";
import { registerCause } from "./registry";

/** Cost of ground a canyon or falls draws the network into, and of a ring's rim. */
export const corridorCost = 0.15,
  rimCost = 4;

/** The landmark records' maintenance ledger, one per refinement state. */
const ledgers = new WeakMap<RegionalState, LandmarkLedger>();

/**
 * Captured landmarks as causes (plan: landmark evidence and support). The records are read
 * placed on this lattice (a region has no epochs to drift through); each kind steers the
 * network as the cause table says: a mountain repels like a summit, a canyon or falls is a
 * corridor the network is drawn into, a ring repels along its rim, an escarpment's fault is
 * a trunk of the fracture set. Support is the world's own maintenance: after each structure
 * realization, the shared owner measures the signature and applies its material correction.
 * Later local development may reshape it; no exterior height rollback preserves a seam.
 */
registerCause({
  kind: "landmark",
  read(state, evidence) {
    evidence.landmarks.push(...capturedLandmarks(state));
  },
  influence(state, cost) {
    for (const { placed } of state.regional.evidence!.landmarks) steer(state, cost, placed);
  },
  restore(state) {
    const ledger = ledgers.get(state) ?? new Map(),
      map = state.physical.map;
    if (!state.regional.evidence!.landmarks.length) return;
    map.LandmarkMaintenance.fill(0);
    for (const { landmark } of state.regional.evidence!.landmarks)
      maintainLandmark(map, state.physical.profile, landmark, 0, ledger);
    ledgers.set(state, ledger);
  },
});

/** The world's landmark records whose placed geometry stands in the frame. */
function capturedLandmarks(state: RegionalState): Evidence["landmarks"] {
  const map = state.physical.map,
    found: Evidence["landmarks"] = [];
  for (const landmark of state.domain.world.landmarks ?? []) {
    const kind = landmarkKind(landmark.kind);
    if (!kind) continue;
    const placed = placeLandmark(map, landmark);
    if (!placed) continue;
    // A record stands in the frame when its ground reaches content (a line may cross the
    // whole frame with both ends outside it).
    const reach = map.scale.supported(kind.reach(placed.parameters), 1);
    if (nearPath(state, placed, reach).length) found.push({ landmark, placed });
  }
  return found;
}

type Steer = (state: RegionalState, cost: Float64Array, placed: Placed, center: number) => void;
/** Each kind's influence on the network's cost field (the cause table's "influence" column). */
const steers: Record<string, Steer> = {
  "volcanic-mountain": massif,
  "resistant-mountain": massif,
  canyon: (state, cost, placed) =>
    corridor(state, cost, placed, MapScale.metres(placed.parameters.rimWidth, "km") / 2),
  falls: (state, cost, placed) => corridor(state, cost, placed, state.physical.map.scale.cells(2)),
  "dome-ring": ring,
  "impact-ring": ring,
  escarpment: (state, _cost, placed) =>
    openFault(state, placed, MapScale.metres(placed.parameters.scarpWidth, "km")),
};
function steer(state: RegionalState, cost: Float64Array, placed: Placed) {
  const mesh = state.physical.map.mesh,
    center = mesh.cellAt(placed.center[0], placed.center[1]);
  steers[placed.landmark.kind]?.(state, cost, placed, center);
}
function massif(state: RegionalState, cost: Float64Array, placed: Placed, center: number) {
  if (center >= 0) repel(state, cost, center, MapScale.metres(placed.parameters.baseRadius, "km"));
}
function corridor(state: RegionalState, cost: Float64Array, placed: Placed, reach: number) {
  for (const i of nearPath(state, placed, reach)) cost[i] *= corridorCost;
}
function ring(state: RegionalState, cost: Float64Array, placed: Placed, center: number) {
  if (center >= 0)
    steerRim(state, cost, center, MapScale.metres(placed.parameters.diameter, "km") / 2);
}

/** Content cells within `reach` of the landmark's path. */
function nearPath(state: RegionalState, placed: Placed, reach: number) {
  const map = state.physical.map,
    mesh = map.mesh,
    metrics = pathMetrics(map, placed.path),
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    if (nearestOnPath(map, metrics, mesh.x(i), mesh.y(i)).distance <= reach) cells.push(i);
  }
  return cells;
}

/** A ring's rim is dear ground a cell wide either side of its radius. */
function steerRim(state: RegionalState, cost: Float64Array, center: number, radius: number) {
  const mesh = state.physical.map.mesh,
    span = regionalSpan(state);
  for (let i = 0; i < mesh.count; i++)
    if (Math.abs(distance(mesh, center, i) - radius) <= span) cost[i] *= rimCost;
}

/**
 * An escarpment's fault is a trunk of the fracture set: conductance along the path at the
 * world's fault strength, fading across the scarp width (as the world's emplacement writes).
 */
function openFault(state: RegionalState, placed: Placed, width: number) {
  const map = state.physical.map,
    mesh = map.mesh,
    metrics = pathMetrics(map, placed.path),
    strength = state.physical.profile.ImpactFractureStrength;
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const hit = nearestOnPath(map, metrics, mesh.x(i), mesh.y(i));
    if (hit.distance > width) continue;
    map.FractureConductance.set(
      i,
      Math.max(map.FractureConductance.get(i), Math.round(strength * (1 - hit.distance / width)))
    );
  }
}
