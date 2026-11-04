import type { Evidence, RegionalState } from "../state";

/**
 * Established features as causes (plan: "Established features as causes"). Each feature kind
 * the refinement reads has one entry saying what it does at each point of the schedule:
 * `read` its captured evidence onto the state (context); `influence` the network's cost field
 * (context, before the network is grown); `support` what the ground must provide once the
 * network exists (a river seat's channel); `caps` the relief gradients its footprint holds
 * down (every structure step); `conjoin` with other features (round two); `respond` on the
 * developed ground after a round's water (a seat settles). Entries register themselves when
 * their module loads; `./index` loads them all. The processes later milestones add for
 * established features (canals, portage pairs, gorge dams, ruin response, the landmark
 * table) are entries here, not new call sites in the schedule.
 */
export interface FeatureCause {
  /** The feature kind, or the captured evidence class, this entry stands for. */
  kind: string;
  read?(state: RegionalState, evidence: Evidence): void;
  influence?(state: RegionalState, cost: Float64Array): void;
  support?(state: RegionalState): void;
  caps?(state: RegionalState, cap: Float64Array): void;
  /** After a structure step's relief is written: restore the feature's signature on it. */
  restore?(state: RegionalState): void;
  conjoin?(state: RegionalState): void;
  respond?(state: RegionalState): void;
}

const causes: FeatureCause[] = [];

export function registerCause(cause: FeatureCause) {
  if (!causes.some((known) => known.kind === cause.kind)) causes.push(cause);
}
export function featureCauses(): readonly FeatureCause[] {
  return causes;
}

/**
 * Context: every entry reads its captured evidence once; the processes read the record. The
 * lists are ordered by identity, not by the feature store's order, so a repeated refinement
 * reads the same evidence in the same order whatever order the last publication left.
 */
export function readEvidence(state: RegionalState): Evidence {
  const evidence: Evidence = {
    courses: [],
    lakes: [],
    seats: [],
    entries: [],
    landmarks: [],
  };
  for (const cause of causes) cause.read?.(state, evidence);
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  evidence.courses.sort((a, b) => byId(a.feature.id, b.feature.id));
  evidence.landmarks.sort((a, b) => byId(a.landmark.id, b.landmark.id));
  evidence.seats.sort((a, b) => byId(a.featureId, b.featureId));
  evidence.entries.sort((a, b) => a.cell - b.cell);
  evidence.lakes.sort((a, b) => a.cells[0] - b.cells[0]);
  state.regional.courses = evidence.courses;
  state.regional.evidence = evidence;
  return evidence;
}
/** Context: the established features steer the cost the network descends. */
export function influenceCosts(state: RegionalState, cost: Float64Array) {
  for (const cause of causes) cause.influence?.(state, cost);
}
/** Context, after the network: what the ground must provide for each feature. */
export function supportFeatures(state: RegionalState) {
  for (const cause of causes) cause.support?.(state);
}
/** Structure step: per-cell hillslope gradient caps from the features' footprints (0 = none). */
export function featureCaps(state: RegionalState) {
  const cap = new Float64Array(state.physical.map.mesh.count);
  for (const cause of causes) cause.caps?.(state, cap);
  return cap;
}
/** After the relief is written: each feature's signature restored by the smallest correction. */
export function restoreFeatures(state: RegionalState) {
  for (const cause of causes) cause.restore?.(state);
}
/** Round two: pairings between features. */
export function conjoinFeatures(state: RegionalState) {
  for (const cause of causes) cause.conjoin?.(state);
}
/** After a round's water: each feature's own change on the developed ground. */
export function respondFeatures(state: RegionalState) {
  for (const cause of causes) cause.respond?.(state);
}
