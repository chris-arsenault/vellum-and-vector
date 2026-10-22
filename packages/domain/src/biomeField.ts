import type { Geometry } from "geojson";
import { biomeCode as B } from "./ecology";
import { spatial, type Bounds } from "./spatial";
import type { EncloseSegment } from "./sampleSegmentBounds";
import { type SampleSupport, type SampleEnclosure } from "./smoothSamples";
import { preparedValue, type PreparedChannelData, type NumericValues } from "./preparedField";

export const biomeInputs = [
  "temperature",
  "water",
  "depth",
  "ice",
  "wetness",
  "moisture",
  "trees",
  "grass",
  "wetland",
  "altered",
  "juvenileAltered",
  "conifer",
  "broadleaf",
] as const;
export type BiomePoint = Record<(typeof biomeInputs)[number], number>;
export interface BiomeSamples {
  values: Record<string, NumericValues>;
  prepared: Record<string, PreparedChannelData>;
  seaLevel: number;
  lakes: { footprint: Geometry; level: number }[];
  protectedMask: Uint8Array;
  protectedCodes: NumericValues;
  protectedRegions?: { code: number; footprint: Geometry }[];
  codes: number[];
}
type BiomeRule =
  | number
  | {
      weights: Partial<BiomePoint>;
      terms: [keyof BiomePoint, number][];
      offset: number;
      yes: BiomeRule;
      no: BiomeRule;
      water?: "ocean" | "lakes";
    };
export type BiomeFieldRule =
  | number
  | {
      test: (x: number, y: number) => number;
      yes: BiomeFieldRule;
      no: BiomeFieldRule;
      region?: Geometry | null;
      exclude?: Geometry | null;
      enclose?: (box: Bounds) => SampleEnclosure;
      segment?: EncloseSegment;
    };
const branch = (
  weights: Partial<BiomePoint>,
  offset: number,
  yes: BiomeRule,
  no: BiomeRule,
  water?: "ocean" | "lakes"
): BiomeRule => ({
  weights,
  terms: Object.entries(weights) as [keyof BiomePoint, number][],
  offset,
  yes,
  no,
  water,
});
const forestRule = branch(
  { conifer: 1, broadleaf: -1 },
  0,
  B("Boreal forest"),
  branch(
    { temperature: -1 },
    8,
    B("Boreal forest"),
    branch(
      { temperature: 1 },
      -22,
      branch({ moisture: 1 }, -0.7, B("Rainforest"), B("Temperate forest")),
      B("Temperate forest")
    )
  )
);
const coverRule = branch(
  { trees: -1, grass: -1, wetland: -1 },
  0.12,
  branch({ moisture: -1 }, 0.25, B("Desert"), B("Barren")),
  branch(
    { trees: -1 },
    0.15,
    B("Grassland"),
    branch(
      { trees: -1 },
      0.4,
      branch({ temperature: 1 }, -18, B("Savanna"), B("Woodland")),
      forestRule
    )
  )
);
const landRule = branch(
  { altered: 1, juvenileAltered: 1 },
  -0.2,
  branch({ wetness: 1 }, -0.5, B("Altered wetland"), B("Altered woodland")),
  branch(
    { wetness: 1 },
    -0.5,
    branch({ trees: 1 }, -0.2, B("Swamp"), B("Marsh")),
    branch({ temperature: -1 }, 2, B("Tundra"), coverRule)
  )
);
const biomeRule = branch(
  { ice: 1 },
  -1,
  B("Ice"),
  branch(
    {},
    0,
    B("Ocean"),
    branch({}, 0, branch({ depth: 1 }, -1.5, B("Freshwater"), landRule), landRule, "lakes"),
    "ocean"
  )
);

/** One decision tree supplies both point classifications and geographic threshold boundaries. */
export function classifyBiomePoint(p: BiomePoint): number {
  let rule = biomeRule;
  while (typeof rule !== "number") {
    const positive =
      rule.water === "ocean"
        ? p.water === 1
        : rule.water === "lakes"
          ? p.water !== 0
          : ruleValue(rule, p) > 0;
    rule = positive ? rule.yes : rule.no;
  }
  return rule;
}
function ruleValue(rule: Exclude<BiomeRule, number>, point: BiomePoint) {
  let value = rule.offset - ruleRoundoff(rule);
  for (const [name, weight] of rule.terms) value += weight * point[name];
  return value;
}
// Equal reconstructed terms take the nonpositive branch despite floating point
// cancellation; point classification and contour expressions share this tie.
const ruleRoundoff = (rule: { offset: number }) =>
  Number.EPSILON * 64 * (1 + Math.abs(rule.offset));
export function biomeFieldInterpolator(
  support: SampleSupport,
  biome: BiomeSamples,
  ocean: Geometry | null | undefined
) {
  const pointAt = biomePointReader(support, biome, ocean),
    protectedAt = protectedBiomeReader(biome);
  const read = (x: number, y: number) => protectedAt(x, y) ?? classifyBiomePoint(pointAt(x, y));
  let partition: BiomeFieldRule | undefined;
  return Object.defineProperty(read, "partition", {
    get: () => {
      if (partition !== undefined) return partition;
      partition = biomePartition(biomeRule, biome, ocean, pointAt);
      for (const { code, footprint } of biome.protectedRegions ?? [])
        partition = {
          test: () => 1,
          region: footprint,
          yes: code,
          no: partition,
        };
      return partition;
    },
  }) as typeof read & { readonly partition: BiomeFieldRule };
}

function biomePointReader(
  support: SampleSupport,
  biome: BiomeSamples,
  ocean: Geometry | null | undefined
) {
  const reads = Object.fromEntries(
    biomeInputs
      .filter((name) => name !== "water" && name !== "depth")
      .map((name) => [name, preparedValue(support, biome.values[name], biome.prepared[name])])
  );
  const elevation = preparedValue(support, biome.values.elevation, biome.prepared.elevation);
  const marine = ocean ? spatial.pointCoverage(ocean) : null;
  const lakes = biome.lakes.map((lake) => ({
    ...lake,
    covers: spatial.pointCoverage(lake.footprint),
  }));
  let px = 0,
    py = 0,
    stage: number | null = null;
  let cache: Partial<BiomePoint> = {};
  const p = Object.defineProperties(
    {} as BiomePoint,
    Object.fromEntries(
      biomeInputs.map((name) => [name, { get: () => (cache[name] ??= read(name)) }])
    )
  );
  const water = () => {
    if (stage !== null) {
      cache.water = 2;
      return stage;
    }
    const position = { x: px, y: py, z: 0 };
    const lake = lakes.find((body) => body.covers(position));
    const sea = marine ? marine(position) : elevation(px, py) < biome.seaLevel;
    cache.water = lake ? 2 : Number(sea);
    return lake?.level ?? biome.seaLevel;
  };
  const read = (name: (typeof biomeInputs)[number]): number => {
    if (name === "water") {
      water();
      return cache.water!;
    }
    if (name === "depth") return Math.max(0, water() - elevation(px, py));
    return reads[name](px, py);
  };
  px = py = NaN;
  const at = (x: number, y: number, level: number | null = null) => {
    if (x === px && y === py && stage === level) return p;
    px = x;
    py = y;
    stage = level;
    cache = {};
    return p;
  };
  const combine = (weights: Partial<BiomePoint>, offset: number, level: number | null) => {
    const terms = Object.entries(weights).map(([name, weight]) => {
      if (name === "depth") {
        offset += weight! * (level ?? biome.seaLevel);
        return { field: elevation, weight: -weight! };
      }
      return { field: reads[name], weight: weight! };
    });
    const read = (x: number, y: number) =>
      terms.reduce((sum, t) => sum + t.weight * t.field(x, y), offset);
    return Object.assign(read, {
      segment: ((a, b) => {
        const result = {
          range: [offset, offset] as [number, number],
          derivative: [0, 0] as [number, number],
        };
        for (const term of terms) {
          const value = term.field.segment(a, b);
          for (const [target, source] of [
            [result.range, value.range],
            [result.derivative, value.derivative],
          ]) {
            target[0] += Math.min(term.weight * source[0], term.weight * source[1]);
            target[1] += Math.max(term.weight * source[0], term.weight * source[1]);
          }
        }
        return result;
      }) as EncloseSegment,
      enclose: (box: Bounds): SampleEnclosure => {
        const result: SampleEnclosure = {
          range: [offset, offset],
          gradient: [
            [0, 0],
            [0, 0],
          ],
        };
        for (const term of terms) {
          const value = term.field.enclose(box);
          for (const [target, source] of [
            [result.range, value.range],
            [result.gradient[0], value.gradient[0]],
            [result.gradient[1], value.gradient[1]],
          ]) {
            target[0] += Math.min(term.weight * source[0], term.weight * source[1]);
            target[1] += Math.max(term.weight * source[0], term.weight * source[1]);
          }
        }
        return result;
      },
    });
  };
  return Object.assign(at, { floor: elevation, combine });
}

function protectedBiomeReader(biome: BiomeSamples) {
  const regions = [...(biome.protectedRegions ?? [])]
    .reverse()
    .map((entry) => ({ code: entry.code, covers: spatial.pointCoverage(entry.footprint) }));
  return (x: number, y: number) => {
    return regions.find((entry) => entry.covers({ x, y, z: 0 }))?.code ?? null;
  };
}

function biomePartition(
  root: BiomeRule,
  biome: BiomeSamples,
  ocean: Geometry | null | undefined,
  pointAt: ReturnType<typeof biomePointReader>
) {
  const lakeShape = biome.lakes.length
    ? spatial.unionAll(biome.lakes.map((lake) => lake.footprint))
    : null;
  const expressions = new Map<BiomeRule, Map<number | null, ReturnType<typeof pointAt.combine>>>();
  const expression = (rule: Exclude<BiomeRule, number>, level: number | null) => {
    const stage = Object.hasOwn(rule.weights, "depth") ? level : null,
      cache = expressions.get(rule) ?? new Map();
    if (!cache.has(stage)) {
      cache.set(stage, pointAt.combine(rule.weights, rule.offset - ruleRoundoff(rule), stage));
    }
    expressions.set(rule, cache);
    return cache.get(stage)!;
  };
  const fieldRule = (rule: BiomeRule, level: number | null = null): BiomeFieldRule => {
    if (typeof rule === "number") return rule;
    if (rule.water === "lakes")
      return biome.lakes.reduceRight<BiomeFieldRule>(
        (no, lake) => ({
          test: () => 1,
          region: lake.footprint,
          yes: fieldRule(rule.yes, lake.level),
          no,
        }),
        fieldRule(rule.no)
      );
    const result: BiomeFieldRule = {
      test: (x, y) => {
        return expression(rule, level)(x, y);
      },
      yes: fieldRule(rule.yes, level),
      no: fieldRule(rule.no, level),
      enclose: (box) => expression(rule, level).enclose(box),
      segment: (a, b) => expression(rule, level).segment(a, b),
    };
    if (rule.water === "ocean") {
      delete result.segment;
      result.test = (x, y) => biome.seaLevel - pointAt.floor(x, y);
      result.enclose = (box) =>
        ruleEnclosure({ weights: { depth: 1 }, offset: biome.seaLevel }, () => {
          const value = pointAt.floor.enclose(box, undefined, biome.seaLevel);
          return {
            range: [-value.range[1], -value.range[0]],
            gradient: value.gradient.map(([low, high]) => [
              -high,
              -low,
            ]) as SampleEnclosure["gradient"],
          };
        });
      result.exclude = lakeShape;
      if (ocean) result.region = ocean;
    }
    return result;
  };
  return fieldRule(root);
}
function ruleEnclosure(
  rule: Pick<Exclude<BiomeRule, number>, "weights" | "offset">,
  read: (name: string) => SampleEnclosure
): SampleEnclosure {
  const result: SampleEnclosure = {
    range: [rule.offset, rule.offset],
    gradient: [
      [0, 0],
      [0, 0],
    ],
  };
  for (const [name, weight] of Object.entries(rule.weights)) {
    const value = read(name),
      scale = weight!;
    for (const [target, source] of [
      [result.range, value.range],
      [result.gradient[0], value.gradient[0]],
      [result.gradient[1], value.gradient[1]],
    ]) {
      target[0] += Math.min(scale * source[0], scale * source[1]);
      target[1] += Math.max(scale * source[0], scale * source[1]);
    }
  }
  return result;
}
