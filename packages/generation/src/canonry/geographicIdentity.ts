import {
  spatial,
  point,
  lineParts,
  type AtlasFeature,
  type DomainSnapshot,
  type FeatureReader,
} from "@atlas/domain";
import type { GenerationState } from "../process";
import {
  generationFeature,
  removeGenerationFeature,
  writeGenerationFeature,
  originalFeatureReader,
} from "../generationFeatures";
import {
  generationNetworks,
  originalNetworks,
  writeGenerationNode,
  writeGenerationReach,
  removeGenerationReach,
} from "../generationNetworks";

type Candidate = { id: string; line: boolean; bounds: number[] };
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

function similarity(
  feature: AtlasFeature,
  candidate: Candidate,
  tolerance: number,
  source: FeatureReader
) {
  const a = spatial.bounds(feature.geometry),
    b = candidate.bounds;
  const gap = Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3], 0);
  if (gap > tolerance || isLine(feature) !== candidate.line) return Infinity;
  if (candidate.line && !lineCorresponds(feature, source.get(candidate.id)!, tolerance))
    return Infinity;
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
function isOriginalProtected(
  state: GenerationState,
  source: DomainSnapshot,
  feature: AtlasFeature
) {
  return (
    Boolean(originalFeatureReader(state, source).get(feature.id)) &&
    preserveOriginal(source, feature)
  );
}
function movableFeature(state: GenerationState, id: string, original: DomainSnapshot) {
  const feature = generationFeature(state, id);
  return feature && !isOriginalProtected(state, original, feature) ? feature : undefined;
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
  const anchor = originalNetworks(state, original).node(anchorId);
  if (!anchor || nodeId === anchorId) return;
  writeGenerationNode(state, structuredClone(anchor));
  for (const reach of generationNetworks(state).reaches({ nodeId })) {
    const start = reach.start === nodeId,
      end = reach.end === nodeId;
    if (!start && !end) continue;
    const feature = movableFeature(state, reach.featureId, original);
    if (!feature) continue;
    const coordinate = [anchor.position.x, anchor.position.y, anchor.position.z];
    moveCoordinate(reach, start, end, coordinate);
    moveCoordinate(feature, start, end, coordinate);
    alignElevation(feature, start, end, anchor.position.z);
    writeGenerationFeature(state, feature);
    reach.start = start ? anchorId : reach.start;
    reach.end = end ? anchorId : reach.end;
    writeGenerationReach(state, reach);
  }
}

function anchorPreservedJunctions(
  state: GenerationState,
  original: DomainSnapshot,
  next: AtlasFeature,
  previous: AtlasFeature
) {
  const old = [...originalNetworks(state, original).reaches({ featureId: previous.id })];
  if (!old.length) return;
  for (const reach of generationNetworks(state).reaches({ featureId: next.id })) {
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
  if (next.id !== previous.id) removeGenerationFeature(state, next.id);
  writeGenerationFeature(
    state,
    preserve
      ? structuredClone(previous)
      : {
          ...next,
          id: previous.id,
          ...(previous.placeId ? { placeId: previous.placeId } : {}),
          name: previous.name,
          relations: previous.relations,
          attributes: { ...next.attributes, ...retainedNameMetadata(previous) },
        }
  );
  for (const reach of generationNetworks(state).reaches({ featureId: next.id })) {
    if (preserve) removeGenerationReach(state, reach.id);
    else writeGenerationReach(state, { ...reach, featureId: previous.id });
  }
  if (preserve) restoreNetwork(state, original, previous.id);
}
function retainedNameMetadata(feature: AtlasFeature) {
  return Object.fromEntries(
    Object.entries(feature.attributes).filter(
      ([key]) => key.startsWith("naming") || key === "namedInEra"
    )
  );
}
function restoreNetwork(state: GenerationState, original: DomainSnapshot, id: string) {
  const network = originalNetworks(state, original);
  for (const reach of network.reaches({ featureId: id })) {
    writeGenerationReach(state, structuredClone(reach));
    for (const node of [reach.start, reach.end]) {
      const value = network.node(node);
      if (value) writeGenerationNode(state, structuredClone(value));
    }
  }
}

function previousCandidates(state: GenerationState, original: DomainSnapshot) {
  const candidates = new Map<string, Candidate[]>();
  for (const feature of originalFeatureReader(state, original).values()) {
    if (
      feature.areaId !== state.domain.scope.areaId ||
      feature.attributes.causeId ||
      !["canonry-0f62584c", "atlas-ecology-1"].includes(String(feature.attributes.sourceAlgorithm))
    )
      continue;
    const key = group(feature);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates
      .get(key)!
      .push({ id: feature.id, line: isLine(feature), bounds: spatial.bounds(feature.geometry) });
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
  const source = originalFeatureReader(state, original);
  for (const id of generated) {
    const previous = source.get(id),
      next = generationFeature(state, id);
    if (!previous || !next) continue;
    used.add(id);
    reuseIdentity(state, original, next, previous);
  }
  if (!candidates.size) return;
  for (const { id } of rankedFeatures(state, original, generated)) {
    const feature = generationFeature(state, id)!;
    const matches = (candidates.get(group(feature)) ?? [])
      .filter((candidate) => !used.has(candidate.id))
      .map((candidate) => ({ candidate, score: similarity(feature, candidate, tolerance, source) }))
      .filter((match) => match.score < 0.35)
      // hpc-exempt: feature match objects, a handful per feature.
      .sort((a, b) => a.score - b.score);
    const previous = matches[0] && source.get(matches[0].candidate.id);
    if (!previous) continue;
    used.add(previous.id);
    reuseIdentity(state, original, feature, previous);
  }
}
function rankedFeatures(state: GenerationState, original: DomainSnapshot, generated: Set<string>) {
  const next: { id: string; length: number }[] = [];
  for (const id of generated) {
    const feature = generationFeature(state, id);
    if (feature && !feature.attributes.causeId && !originalFeatureReader(state, original).get(id))
      next.push({ id, length: spatial.length(feature.geometry) });
  }
  // hpc-exempt: generated feature records, sorted once by length.
  return next.sort((a, b) => b.length - a.length);
}
