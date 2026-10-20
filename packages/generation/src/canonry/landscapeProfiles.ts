import type { Position } from "@atlas/domain";
import type { Geometry } from "geojson";
import { spatial } from "@atlas/domain";
import { footprintWeight } from "./landscapeFootprint";

/** Disposable generation targets; never attach these to a published field. */
export interface LandscapeProfile {
  id: string;
  points: [number, number][];
  widths: number[];
  values: Record<string, number[]>;
  operation: "replace" | "lower" | "raise" | "offset";
  footprint?: Geometry;
  plateau?: boolean;
  exclusions?: Record<string, Geometry[]>;
  edgeBlend?: number;
  strength?: number;
  radial?: { center: [number, number]; radii: number[]; fractions: number[]; heights: number[][] };
  flat?: number;
}
type Segment = { profile: number; station: number };
type Index = {
  levels: Map<number, Map<string, Segment[]>>;
  covered: Map<number, (p: Position) => number>;
  excluded: Map<number, Record<string, ((p: Position) => boolean)[]>>;
};
const indexes = new WeakMap<LandscapeProfile[], Index>();
const coverages = new WeakMap<Geometry, (p: Position) => boolean>();
const key = (x: number, y: number) => `${x}:${y}`;

function segmentBounds(profile: LandscapeProfile, station: number) {
  const a = profile.points[station],
    b = profile.points[Math.min(station + 1, profile.points.length - 1)],
    radius = Math.max(profile.widths[station], profile.widths[station + 1] ?? 0);
  return [
    Math.min(a[0], b[0]) - radius,
    Math.min(a[1], b[1]) - radius,
    Math.max(a[0], b[0]) + radius,
    Math.max(a[1], b[1]) + radius,
  ];
}
function indexProfiles(profiles: LandscapeProfile[]): Index {
  const cached = indexes.get(profiles);
  if (cached) return cached;
  const widths = profiles.flatMap((p) => p.widths).sort((a, b) => a - b);
  const size = Math.max(1000, (widths[widths.length >>> 1] ?? 1000) * 4),
    levels = new Map<number, Map<string, Segment[]>>();
  profiles.forEach((profile, n) => {
    for (let station = 0; station < Math.max(1, profile.points.length - 1); station++) {
      const [x0, y0, x1, y1] = segmentBounds(profile, station);
      // Index broad profiles at their own scale instead of scanning every broad
      // segment for every query or allocating millions of small empty bins.
      const scale =
          size * 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(x1 - x0, y1 - y0) / (size * 3)))),
        bins = levels.get(scale) ?? new Map<string, Segment[]>();
      levels.set(scale, bins);
      for (let x = Math.floor(x0 / scale); x <= Math.floor(x1 / scale); x++)
        for (let y = Math.floor(y0 / scale); y <= Math.floor(y1 / scale); y++) {
          const at = key(x, y),
            entries = bins.get(at) ?? [];
          entries.push({ profile: n, station });
          bins.set(at, entries);
        }
    }
  });
  const covered = new Map<number, (p: Position) => number>(),
    excluded = new Map<number, Record<string, ((p: Position) => boolean)[]>>();
  profiles.forEach((profile, n) => {
    if (profile.footprint) {
      covered.set(n, footprintWeight(profile.footprint, profile.edgeBlend));
    }
    if (profile.exclusions)
      excluded.set(
        n,
        Object.fromEntries(
          Object.entries(profile.exclusions).map(([channel, shapes]) => [
            channel,
            shapes.map((shape) => {
              const at = coverages.get(shape) ?? spatial.pointCoverage(shape);
              coverages.set(shape, at);
              return at;
            }),
          ])
        )
      );
  });
  const index = { levels, covered, excluded };
  indexes.set(profiles, index);
  return index;
}
function section(profile: LandscapeProfile, station: number, p: Position, limit: number) {
  const a = profile.points[station],
    next = Math.min(station + 1, profile.points.length - 1),
    b = profile.points[next],
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / length)) : 0;
  const px = p.x - a[0] - dx * t,
    py = p.y - a[1] - dy * t,
    width = profile.widths[station] * (1 - t) + profile.widths[next] * t,
    relativeSquared = (px * px + py * py) / (width * width);
  return relativeSquared < limit ? { t, next, relativeSquared } : null;
}

/** Shared by field queries, raster sampling and physical feature publication. */
export function landscapeInterpolator(
  profiles: LandscapeProfile[] | undefined,
  channel: string,
  base: (p: Position) => number,
  categorical = false
): (p: Position) => number {
  if (!profiles?.some((p) => p.values[channel])) return base;
  const index = indexProfiles(profiles);
  return (p) => {
    const nearest = nearestSections(index, profiles, channel, p);
    let value = base(p);
    for (const [n, at] of [...nearest].sort(([a], [b]) => a - b)) {
      if (!at.support) continue;
      const profile = profiles[n],
        values = profile.values[channel],
        target =
          channel === "elevation" && profile.radial
            ? radialHeight(profile.radial, p)
            : categorical
              ? values[at.t < 0.5 ? at.station : at.next]
              : values[at.station] * (1 - at.t) + values[at.next] * at.t,
        weight = sectionWeight(profile, at.relativeSquared) * at.support * (profile.strength ?? 1);
      const operation =
        channel === "elevation" || channel === "bedrock" ? profile.operation : "replace";
      value = applySection(value, target, weight, operation, categorical);
    }
    return value;
  };
}
function sectionWeight(profile: LandscapeProfile, relativeSquared: number) {
  if (profile.plateau) return 1;
  if (!profile.flat) return (1 - relativeSquared) ** 2;
  const relative = Math.max(0, (Math.sqrt(relativeSquared) - profile.flat) / (1 - profile.flat));
  return (1 - relative * relative) ** 2;
}
function radialHeight(radial: NonNullable<LandscapeProfile["radial"]>, p: Position) {
  const dx = p.x - radial.center[0],
    dy = p.y - radial.center[1],
    angle = ((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1) * radial.radii.length,
    a = Math.floor(angle),
    b = (a + 1) % radial.radii.length,
    t = angle - a,
    radius = radial.radii[a] * (1 - t) + radial.radii[b] * t,
    distance = Math.hypot(dx, dy) / radius;
  let index = 0;
  while (index < radial.fractions.length - 2 && distance > radial.fractions[index + 1]) index++;
  const u = Math.max(
      0,
      Math.min(
        1,
        (distance - radial.fractions[index]) /
          (radial.fractions[index + 1] - radial.fractions[index])
      )
    ),
    smooth = u * u * (3 - 2 * u),
    height = (sector: number) =>
      radial.heights[sector][index] * (1 - smooth) + radial.heights[sector][index + 1] * smooth;
  return height(a) * (1 - t) + height(b) * t;
}
function hasChannel(profile: LandscapeProfile, channel: string | null) {
  return channel === null || Boolean(profile.values[channel]);
}
function nearestSections(
  index: Index,
  profiles: LandscapeProfile[],
  channel: string | null,
  p: Position
) {
  const nearest = new Map<
    number,
    { station: number; t: number; next: number; relativeSquared: number; support: number }
  >();
  for (const [size, bins] of index.levels)
    for (const entry of bins.get(key(Math.floor(p.x / size), Math.floor(p.y / size))) ?? []) {
      const profile = profiles[entry.profile],
        previous = nearest.get(entry.profile);
      if (!hasChannel(profile, channel)) continue;
      const at = section(profile, entry.station, p, previous?.relativeSquared ?? 1);
      if (!at) continue;
      const support = previous?.support ?? supportedSection(index, entry.profile, p, channel);
      nearest.set(entry.profile, { ...at, station: entry.station, support });
    }
  return nearest;
}
/** Evaluate a construction station once across its channels and overlapping systems. */
export function landscapeStationSampler(
  profiles: LandscapeProfile[],
  readers: Record<string, (p: Position) => number>,
  narrow: Set<LandscapeProfile>,
  categories: Set<string>
) {
  const index = indexProfiles(profiles),
    settings = { index, readers, narrow, categories };
  return (p: Position) => {
    const values = Object.fromEntries(
      Object.entries(readers).map(([name, read]) => [name, read(p)])
    );
    const result = { values, broadHeight: values.elevation, coverage: 0 };
    const sections = nearestSections(index, profiles, null, p);
    for (const [n, at] of [...sections].sort(([a], [b]) => a - b)) {
      applyStationValues(profiles[n], n, at, settings, p, result);
    }
    return result;
  };
}
type Station = {
  station: number;
  next: number;
  t: number;
  relativeSquared: number;
  support: number;
};
type StationSettings = {
  index: Index;
  readers: Record<string, (p: Position) => number>;
  narrow: Set<LandscapeProfile>;
  categories: Set<string>;
};
function applyStationValues(
  profile: LandscapeProfile,
  n: number,
  at: Station,
  settings: StationSettings,
  p: Position,
  result: { values: Record<string, number>; broadHeight: number; coverage: number }
) {
  const weight = sectionWeight(profile, at.relativeSquared) * at.support * (profile.strength ?? 1);
  if (!weight) return;
  for (const name of Object.keys(profile.values)) {
    if (!stationChannelAllowed(settings, n, name, p)) continue;
    const category = settings.categories.has(name),
      target = stationTarget(profile, name, at, p, category),
      operation = name === "elevation" || name === "bedrock" ? profile.operation : "replace";
    result.values[name] = applySection(result.values[name], target, weight, operation, category);
    if (name !== "elevation") continue;
    if (settings.narrow.has(profile)) result.coverage += (1 - result.coverage) * weight;
    else
      result.broadHeight = applySection(
        result.broadHeight,
        target,
        weight,
        profile.operation,
        false
      );
  }
}
function stationChannelAllowed(settings: StationSettings, n: number, name: string, p: Position) {
  return (
    name in settings.readers &&
    !settings.index.excluded.get(n)?.[name]?.some((covered) => covered(p))
  );
}
function stationTarget(
  profile: LandscapeProfile,
  name: string,
  at: Station,
  p: Position,
  category: boolean
) {
  if (name === "elevation" && profile.radial) return radialHeight(profile.radial, p);
  const values = profile.values[name];
  return category
    ? values[at.t < 0.5 ? at.station : at.next]
    : values[at.station] * (1 - at.t) + values[at.next] * at.t;
}

/** Physical gradient from the same final field, including subcell terrain fits. */
export function landscapeSlope(height: (p: Position) => number, p: Position) {
  const step = 100;
  return (
    Math.hypot(
      height({ ...p, x: p.x + step }) - height({ ...p, x: p.x - step }),
      height({ ...p, y: p.y + step }) - height({ ...p, y: p.y - step })
    ) /
    (2 * step)
  );
}
function supportedSection(index: Index, profile: number, p: Position, channel: string | null) {
  if (channel && index.excluded.get(profile)?.[channel]?.some((covers) => covers(p))) return 0;
  const covered = index.covered.get(profile);
  return covered ? covered(p) : 1;
}
function applySection(
  value: number,
  target: number,
  weight: number,
  operation: LandscapeProfile["operation"],
  categorical: boolean
) {
  if (categorical) return weight >= 0.5 ? target : value;
  if (operation === "offset") return value + target * weight;
  const fitted = value + (target - value) * weight;
  if (operation === "lower") return Math.min(value, fitted);
  return operation === "raise" ? Math.max(value, fitted) : fitted;
}
