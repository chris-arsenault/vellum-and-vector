import { landmarkKind } from "@atlas/domain";
import { nearestOnPath, pathMetrics, type Placed } from "../../canonry/landmarkGeometry";
import { maintainLandmark, placeLandmark, type LandmarkLedger } from "../../canonry/landmarks";
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
 * step's relief is written, the signature is measured and the smallest correction applied,
 * which never stacks because the relief is re-derived first.
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
      map = state.physical.map,
      mesh = map.mesh,
      exterior = new Float64Array(mesh.count);
    if (!state.regional.evidence!.landmarks.length) return;
    // The world's correction writes every cell within reach; the halo keeps the parent's
    // ground (as the relief does) and each round's maintenance is booked afresh.
    for (let i = 0; i < mesh.count; i++) exterior[i] = map.Elevation.get(i);
    map.LandmarkMaintenance.fill(0);
    for (const { landmark } of state.regional.evidence!.landmarks)
      maintainLandmark(map, state.physical.profile, landmark, 0, ledger);
    for (let i = 0; i < mesh.count; i++)
      if (!isContent(mesh, i)) {
        map.Elevation.set(i, exterior[i]);
        map.BedrockElevation.set(i, exterior[i] - map.SedimentThickness.get(i));
      }
    ledgers.set(state, ledger);
  },
});

/** The world's landmark records whose placed geometry stands in the frame. */
function capturedLandmarks(state: RegionalState): Evidence["landmarks"] {
  const map = state.physical.map,
    mesh = map.mesh,
    found: Evidence["landmarks"] = [];
  for (const landmark of state.domain.world.landmarks ?? []) {
    const kind = landmarkKind(landmark.kind);
    if (!kind) continue;
    const placed = placeLandmark(map, landmark);
    if (!placed) continue;
    // A record stands in the frame when its ground reaches content (a line may cross the
    // whole frame with both ends outside it).
    const reach = Math.max(kind.reach(placed.parameters), mesh.spacing);
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
    corridor(state, cost, placed, (placed.parameters.rimWidth * 1000) / 2),
  falls: (state, cost, placed) => corridor(state, cost, placed, 2 * regionalSpan(state)),
  "dome-ring": ring,
  "impact-ring": ring,
  escarpment: (state, _cost, placed) =>
    openFault(state, placed, placed.parameters.scarpWidth * 1000),
};
function steer(state: RegionalState, cost: Float64Array, placed: Placed) {
  const mesh = state.physical.map.mesh,
    center = mesh.cellAt(placed.center[0], placed.center[1]);
  steers[placed.landmark.kind]?.(state, cost, placed, center);
}
function massif(state: RegionalState, cost: Float64Array, placed: Placed, center: number) {
  if (center >= 0) repel(state, cost, center, placed.parameters.baseRadius * 1000);
}
function corridor(state: RegionalState, cost: Float64Array, placed: Placed, reach: number) {
  for (const i of nearPath(state, placed, reach)) cost[i] *= corridorCost;
}
function ring(state: RegionalState, cost: Float64Array, placed: Placed, center: number) {
  if (center >= 0) steerRim(state, cost, center, (placed.parameters.diameter * 1000) / 2);
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
