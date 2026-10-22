import {
  preparedValue,
  spatial,
  geometryParts,
  type Bounds,
  type SampleEnclosure,
  type EncloseSegment,
  sampleCombination,
  type SampleSupport,
  type SampleJets,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";
import type { PhysicalArrayName } from "./continuousState";
import { physicalContour } from "./geographicContours";

export type CausalScalar = ((x: number, y: number) => number) & {
  samples?: { support: SampleSupport; values: ArrayLike<number>; coefficients: SampleJets };
  enclose?: (box: Bounds, candidates?: number[], level?: number) => SampleEnclosure;
  segment?: EncloseSegment;
  positiveSupport?: () => CausalScalar | null;
};
export type CausalRegion =
  | boolean
  | { kind: "threshold"; field: CausalScalar; level: number; greater: boolean; inclusive: boolean }
  | { kind: "shape"; shape: Geometry | null }
  | { kind: "and" | "or"; terms: CausalRegion[] }
  | { kind: "not"; term: CausalRegion };
export const all = (...terms: CausalRegion[]): CausalRegion => ({ kind: "and", terms });
export const any = (...terms: CausalRegion[]): CausalRegion => ({ kind: "or", terms });
export const not = (term: CausalRegion): CausalRegion => ({ kind: "not", term });
export const above = (field: CausalScalar, level: number, inclusive = true): CausalRegion => ({
  kind: "threshold",
  field,
  level,
  greater: true,
  inclusive,
});
export const below = (field: CausalScalar, level: number, inclusive = true): CausalRegion => ({
  kind: "threshold",
  field,
  level,
  greater: false,
  inclusive,
});
export const regionShape = (shape: Geometry | null): CausalRegion => ({ kind: "shape", shape });
export function polygonRegion(shape: Geometry | null): Geometry | null {
  if (!shape || spatial.area(shape) <= 0) return null;
  if (shape.type === "Polygon" || shape.type === "MultiPolygon") return shape;
  const parts = geometryParts(shape).filter((part) => part.type === "Polygon");
  return parts.length ? spatial.unionAll(parts) : null;
}
export function physicalScalar(state: GenerationState, name: PhysicalArrayName): CausalScalar {
  const map = state.physical!.map,
    continuous = map.continuous;
  if (!continuous) throw new Error(`Prepare ${name} before constructing its region.`);
  const read: CausalScalar = preparedValue(continuous.support, map[name], {
    coefficients: continuous.coefficients[name],
    adaptive: continuous.adaptive[name],
  });
  if (!continuous.adaptive[name] && continuous.coefficients[name])
    read.samples = {
      support: continuous.support,
      values: map[name],
      coefficients: continuous.coefficients[name]!,
    };
  return read;
}
export function sumScalar(terms: [CausalScalar, number][]): CausalScalar {
  const support = terms[0]?.[0].samples?.support;
  if (support && terms.every(([field]) => field.samples?.support === support)) {
    const read = sampleCombination(
      support,
      terms.map(([field, scale]) => ({ ...field.samples!, scale }))
    );
    return Object.assign(read, {
      samples: { support, values: read.sourceValues, coefficients: read.coefficients },
    });
  }
  const at: CausalScalar = (x, y) =>
    terms.reduce((sum, [read, scale]) => sum + read(x, y) * scale, 0);
  if (terms.every(([field]) => field.segment))
    at.segment = (a, b) => {
      const result = { range: [0, 0] as [number, number], derivative: [0, 0] as [number, number] };
      for (const [field, scale] of terms) {
        const e = field.segment!(a, b);
        for (const [target, source] of [
          [result.range, e.range],
          [result.derivative, e.derivative],
        ]) {
          target[0] += Math.min(source[0] * scale, source[1] * scale);
          target[1] += Math.max(source[0] * scale, source[1] * scale);
        }
      }
      return result;
    };
  if (terms.every(([field]) => field.enclose))
    at.enclose = (box) => {
      const result: SampleEnclosure = {
        range: [0, 0],
        gradient: [
          [0, 0],
          [0, 0],
        ],
      };
      for (const [field, scale] of terms) {
        const bounds = field.enclose!(box);
        for (const [target, source] of [
          [result.range, bounds.range],
          [result.gradient[0], bounds.gradient[0]],
          [result.gradient[1], bounds.gradient[1]],
        ]) {
          target[0] += Math.min(source[0] * scale, source[1] * scale);
          target[1] += Math.max(source[0] * scale, source[1] * scale);
        }
      }
      return result;
    };
  return at;
}
const tie = (level: number) =>
  level === 0 ? 0 : Number.EPSILON * 64 * Math.max(1, Math.abs(level));
export function regionReader(region: CausalRegion): (x: number, y: number) => boolean {
  if (typeof region === "boolean") return () => region;
  if (region.kind === "shape") {
    const covers = region.shape && spatial.pointCoverage(region.shape);
    return (x, y) => Boolean(covers?.({ x, y, z: 0 }));
  }
  if (region.kind === "threshold") {
    const sign = region.greater ? 1 : -1;
    return (x, y) =>
      region.inclusive
        ? sign * (region.field(x, y) - region.level) >= -tie(region.level)
        : sign * (region.field(x, y) - region.level) > tie(region.level);
  }
  if (region.kind === "not") {
    const read = regionReader(region.term);
    return (x, y) => !read(x, y);
  }
  const reads = region.terms.map(regionReader);
  return region.kind === "and"
    ? (x, y) => reads.every((read) => read(x, y))
    : (x, y) => reads.some((read) => read(x, y));
}
/** Trace primitive inequalities separately so sub-sample bands survive their intersections. */
export function regionTracer(state: GenerationState) {
  const cache = new Map<CausalRegion, Geometry | null>();
  const thresholdCache = new Map<CausalScalar, Map<string, Geometry | null>>();
  const domain = state.domain.scope.footprint;
  const known = regionCertainty(spatial.bounds(domain));
  const clip = (shape: Geometry | null, scope: Geometry) =>
    shape && (scope === domain ? shape : polygonRegion(spatial.intersection(shape, scope)));
  const trace = (region: CausalRegion, scope = domain): Geometry | null => {
    if (cache.has(region)) return clip(cache.get(region)!, scope);
    const certain = known(region);
    if (certain !== null) return certain ? scope : null;
    const thresholdKey =
      typeof region !== "boolean" && region.kind === "threshold"
        ? `${region.level}:${region.greater}:${region.inclusive}`
        : null;
    if (thresholdKey && typeof region !== "boolean" && region.kind === "threshold") {
      const previous = thresholdCache.get(region.field);
      if (previous?.has(thresholdKey)) return clip(previous.get(thresholdKey)!, scope);
    }
    let result: Geometry | null;
    if (typeof region === "boolean") result = region ? scope : null;
    else if (region.kind === "shape")
      result = region.shape && spatial.intersection(region.shape, scope);
    else if (region.kind === "threshold") {
      const support =
        region.level === 0 &&
        region.greater !== region.inclusive &&
        region.field.positiveSupport?.();
      if (support) {
        const positive = () =>
          boundedContour(state, scope, support, support.enclose, support.segment);
        if (region.greater) result = positive();
        else {
          const area = positive();
          result = area ? spatial.difference(scope, area) : scope;
        }
        if (scope === domain) cache.set(region, result);
        return result;
      }
      const sign = region.greater ? 1 : -1;
      const offset =
        -sign * region.level +
        (region.inclusive ? Math.max(Number.MIN_VALUE, tie(region.level)) : -tie(region.level));
      const at = (x: number, y: number) => sign * region.field(x, y) + offset;
      const enclose = region.field.enclose
        ? (box: Bounds): SampleEnclosure => {
            const e = region.field.enclose!(box, undefined, -offset / sign);
            const scale = (v: [number, number], shift = 0): [number, number] => [
              Math.min(v[0] * sign, v[1] * sign) + shift,
              Math.max(v[0] * sign, v[1] * sign) + shift,
            ];
            return {
              range: scale(e.range, offset),
              gradient: [scale(e.gradient[0]), scale(e.gradient[1])],
            };
          }
        : undefined;
      const segment: EncloseSegment | undefined = region.field.segment
        ? (a, b) => {
            const e = region.field.segment!(a, b, -offset / sign);
            const scale = (v: [number, number], shift = 0): [number, number] => [
              Math.min(v[0] * sign, v[1] * sign) + shift,
              Math.max(v[0] * sign, v[1] * sign) + shift,
            ];
            return { range: scale(e.range, offset), derivative: scale(e.derivative) };
          }
        : undefined;
      result = boundedContour(state, scope, at, enclose, segment);
    } else if (region.kind === "not") {
      const excluded = trace(region.term, scope);
      result = excluded ? spatial.difference(scope, excluded) : scope;
    } else if (region.kind === "or") {
      const parts = region.terms
        .map((term) => trace(term, scope))
        .filter((shape): shape is Geometry => shape !== null);
      result = parts.length ? spatial.unionAll(parts) : null;
    } else {
      result = scope;
      for (const term of region.terms) {
        if (!result) break;
        result = trace(term, result);
      }
    }
    result = polygonRegion(result);
    if (
      scope === domain &&
      thresholdKey &&
      typeof region !== "boolean" &&
      region.kind === "threshold"
    ) {
      const entries = thresholdCache.get(region.field) ?? new Map();
      entries.set(thresholdKey, result);
      thresholdCache.set(region.field, entries);
    }
    if (scope === domain) cache.set(region, result);
    return result;
  };
  return trace;
}
/** Prove empty/full Boolean branches before tracing any of their expensive terms. */
function regionCertainty(bounds: Bounds) {
  const cache = new Map<CausalRegion, boolean | null>();
  const known = (region: CausalRegion): boolean | null => {
    if (cache.has(region)) return cache.get(region)!;
    let result: boolean | null = null;
    if (typeof region === "boolean") result = region;
    else if (region.kind === "shape") result = region.shape ? null : false;
    else if (region.kind === "threshold") result = thresholdCertainty(region, bounds);
    else if (region.kind === "not") {
      const value = known(region.term);
      result = value === null ? null : !value;
    } else {
      const values = region.terms.map(known),
        decisive = region.kind === "or";
      result = values.includes(decisive) ? decisive : values.includes(null) ? null : !decisive;
    }
    cache.set(region, result);
    return result;
  };
  return known;
}
function thresholdCertainty(region: Extract<CausalRegion, { kind: "threshold" }>, bounds: Bounds) {
  const range = region.field.enclose?.(bounds, undefined, region.level).range;
  if (!range) return null;
  // The threshold is monotone in value, so agreement at both enclosure ends is decisive.
  const test = (value: number) => regionReader({ ...region, field: () => value })(0, 0);
  const low = test(range[0]),
    high = test(range[1]);
  return low === high ? low : null;
}
function boundedContour(
  state: GenerationState,
  scope: Geometry,
  at: CausalScalar,
  enclose?: CausalScalar["enclose"],
  segment?: EncloseSegment
) {
  const range = enclose?.(spatial.bounds(scope)).range;
  if (range && range[1] <= 0) return null;
  if (range && range[0] > 0) return scope;
  const shape = physicalContour(state, at, enclose, segment, scope);
  return shape && polygonRegion(spatial.intersection(shape, scope));
}
