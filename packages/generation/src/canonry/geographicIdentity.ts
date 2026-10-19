import { spatial, point, lineParts, type AtlasFeature, type DomainSnapshot } from "@atlas/domain";
import type { GenerationState } from "../process";

type Candidate = { feature: AtlasFeature; bounds: number[] };
const group = (f: AtlasFeature) =>
  `${f.kind}:${f.layerId}:${f.attributes.system ?? ""}:${f.attributes.rule ?? ""}`;
const isLine = (f: AtlasFeature) => f.geometry.type.includes("LineString");

function lineCorresponds(a: AtlasFeature, b: AtlasFeature, tolerance: number) {
  const first = lineParts(a.geometry).flat(),
    second = lineParts(b.geometry).flat();
  for (const index of [0, -1]) {
    const x = first.at(index)!,
      y = second.at(index)!;
    if (Math.hypot(x[0] - y[0], x[1] - y[1]) > tolerance) return false;
  }
  return [a, b].every((feature, side) => {
    const coordinates = side === 0 ? first : second,
      other = side === 0 ? b : a;
    return coordinates
      .filter((_, i) => i % Math.max(1, Math.floor(coordinates.length / 8)) === 0)
      .every(
        (p) => spatial.distance(other.geometry, point({ x: p[0], y: p[1], z: 0 })) <= tolerance
      );
  });
}

function similarity(feature: AtlasFeature, candidate: Candidate, tolerance: number) {
  const a = spatial.bounds(feature.geometry),
    b = candidate.bounds;
  const gap = Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3], 0);
  if (gap > tolerance || isLine(feature) !== isLine(candidate.feature)) return Infinity;
  if (isLine(feature) && !lineCorresponds(feature, candidate.feature, tolerance)) return Infinity;
  const size = Math.max(
    tolerance,
    Math.hypot(a[2] - a[0], a[3] - a[1]),
    Math.hypot(b[2] - b[0], b[3] - b[1])
  );
  const distance = Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2);
  return (distance + a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / 4) / size;
}

function preserveOriginal(source: DomainSnapshot, feature: AtlasFeature) {
  return (
    feature.protected ||
    feature.state === "authored" ||
    Object.keys(feature.detail).length > 0 ||
    Object.values(source.world.areas).some((area) =>
      area.boundary?.crossings.some((c) => c.featureId === feature.id)
    )
  );
}
function isOriginalProtected(source: DomainSnapshot, feature: AtlasFeature) {
  return Boolean(source.world.features[feature.id]) && preserveOriginal(source, feature);
}

function moveCoordinate(
  feature: { geometry: AtlasFeature["geometry"] },
  start: boolean,
  end: boolean,
  coordinate: number[]
) {
  if (feature.geometry.type !== "LineString") return;
  const coordinates = feature.geometry.coordinates;
  const anchored = (current: number[]) =>
    current.length > 2 ? coordinate.slice() : coordinate.slice(0, 2);
  if (start) coordinates[0] = anchored(coordinates[0]);
  if (end) coordinates[coordinates.length - 1] = anchored(coordinates.at(-1)!);
}
function alignElevation(feature: AtlasFeature, start: boolean, end: boolean, elevation: number) {
  const elevations = feature.attributes.elevations;
  if (!Array.isArray(elevations) || !elevations.length) return;
  if (start) elevations[0] = elevation;
  if (end) elevations[elevations.length - 1] = elevation;
}
function moveEndpoint(
  state: GenerationState,
  nodeId: string,
  anchorId: string,
  original: DomainSnapshot
) {
  const anchor = original.world.networkNodes?.[anchorId];
  if (!anchor || nodeId === anchorId) return;
  state.domain.world.networkNodes![anchorId] = structuredClone(anchor);
  for (const reach of Object.values(state.domain.world.networkReaches!)) {
    const start = reach.start === nodeId,
      end = reach.end === nodeId;
    if (!start && !end) continue;
    const feature = state.domain.world.features[reach.featureId];
    if (isOriginalProtected(original, feature)) continue;
    const coordinate = [anchor.position.x, anchor.position.y, anchor.position.z];
    moveCoordinate(reach, start, end, coordinate);
    moveCoordinate(feature, start, end, coordinate);
    alignElevation(feature, start, end, anchor.position.z);
    reach.start = start ? anchorId : reach.start;
    reach.end = end ? anchorId : reach.end;
  }
}

function anchorPreservedJunctions(
  state: GenerationState,
  original: DomainSnapshot,
  next: AtlasFeature,
  previous: AtlasFeature
) {
  const old = Object.values(original.world.networkReaches ?? {}).filter(
    (reach) => reach.featureId === previous.id
  );
  if (!old.length) return;
  for (const reach of Object.values(state.domain.world.networkReaches ?? {})) {
    if (reach.featureId !== next.id) continue;
    moveEndpoint(state, reach.start, old[0].start, original);
    moveEndpoint(state, reach.end, old.at(-1)!.end, original);
  }
}

function reuseIdentity(
  state: GenerationState,
  original: DomainSnapshot,
  next: AtlasFeature,
  previous: AtlasFeature
) {
  const preserve = preserveOriginal(original, previous);
  if (preserve) anchorPreservedJunctions(state, original, next, previous);
  if (next.id !== previous.id) delete state.domain.world.features[next.id];
  state.domain.world.features[previous.id] = preserve
    ? structuredClone(previous)
    : { ...next, id: previous.id, name: previous.name, relations: previous.relations };
  for (const reach of Object.values(state.domain.world.networkReaches ?? {})) {
    if (reach.featureId !== next.id) continue;
    if (preserve) delete state.domain.world.networkReaches![reach.id];
    else reach.featureId = previous.id;
  }
  if (preserve) restoreNetwork(state, original, previous.id);
}
function restoreNetwork(state: GenerationState, original: DomainSnapshot, id: string) {
  for (const reach of Object.values(original.world.networkReaches ?? {})) {
    if (reach.featureId !== id) continue;
    state.domain.world.networkReaches![reach.id] = structuredClone(reach);
    for (const node of [reach.start, reach.end]) {
      const value = original.world.networkNodes?.[node];
      if (value) state.domain.world.networkNodes![node] = structuredClone(value);
    }
  }
}

function previousCandidates(state: GenerationState, original: DomainSnapshot) {
  const candidates = new Map<string, Candidate[]>();
  for (const feature of Object.values(original.world.features)) {
    if (
      feature.areaId !== state.domain.scope.areaId ||
      feature.attributes.causeId ||
      feature.attributes.sourceAlgorithm !== "canonry-0f62584c"
    )
      continue;
    const key = group(feature);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key)!.push({ feature, bounds: spatial.bounds(feature.geometry) });
  }
  return candidates;
}

/** Preserve semantic objects across resampling; explicit event cause IDs need no spatial association. */
export function retainGeographicIdentities(
  state: GenerationState,
  original: DomainSnapshot,
  tolerance: number,
  generated: Set<string>
) {
  const candidates = previousCandidates(state, original),
    used = new Set<string>();
  for (const id of generated) {
    const previous = original.world.features[id],
      next = state.domain.world.features[id];
    if (!previous || !next) continue;
    used.add(id);
    reuseIdentity(state, original, next, previous);
  }
  if (!candidates.size) return;
  const next = [...generated]
    .map((id) => state.domain.world.features[id])
    .filter(
      (feature) => feature && !feature.attributes.causeId && !original.world.features[feature.id]
    );
  next.sort((a, b) => spatial.length(b.geometry) - spatial.length(a.geometry));
  for (const feature of next) {
    const matches = (candidates.get(group(feature)) ?? [])
      .filter((candidate) => !used.has(candidate.feature.id))
      .map((candidate) => ({ candidate, score: similarity(feature, candidate, tolerance) }))
      .filter((match) => match.score < 0.35)
      .sort((a, b) => a.score - b.score);
    const previous = matches[0]?.candidate.feature;
    if (!previous) continue;
    used.add(previous.id);
    reuseIdentity(state, original, feature, previous);
  }
}
