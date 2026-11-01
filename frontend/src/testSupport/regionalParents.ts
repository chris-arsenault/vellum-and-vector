import { biomeCode, surfaceCode } from "@atlas/domain";

/**
 * The constructed parents of the frozen regional evaluation (spec section 9.1): P1, a
 * mountain country, and P2, a dry plateau above a coastal basin, each at the coarse world
 * sampling scale with the courses, towns and summits the capture would carry.
 */
export const evaluationSeed = 73;
/** World sampling of the constructed parents: the default world's 200 km² cells. */
export const parentSpacing = Math.sqrt(200e6);
export const parentWidth = 1_500_000,
  parentHeight = 1_000_000;

/** Axis-aligned frame helpers shared by the constructed parents. */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const gaussian = (d: number, width: number) => Math.exp(-((d / width) ** 2));

export interface Course {
  name: string;
  points: [number, number][];
  flow: (t: number) => number;
  order: number;
}
export interface Town {
  name: string;
  position: [number, number];
  population: number;
}
type Field = (x: number, y: number) => number;
export interface ParentSpec {
  name: string;
  channels: Record<string, [string, Field]>;
  courses: Course[];
  towns: Town[];
  peaks: { name: string; position: [number, number]; prominence: number; elevation: number }[];
  density: Field;
}

/** A line of points from `from` along `direction`, bending with `bend`, until `until` stops it. */
function traceCourse(
  from: [number, number],
  direction: [number, number],
  step: number,
  bend: (k: number) => number,
  until: (p: [number, number]) => boolean
): [number, number][] {
  const points: [number, number][] = [from];
  let [x, y] = from,
    [dx, dy] = direction;
  for (let k = 0; k < 400; k++) {
    const angle = bend(k),
      ndx = dx * Math.cos(angle) - dy * Math.sin(angle),
      ndy = dx * Math.sin(angle) + dy * Math.cos(angle);
    dx = ndx;
    dy = ndy;
    x += dx * step;
    y += dy * step;
    if (x < 0 || y < 0 || x > parentWidth || y > parentHeight) break;
    points.push([x, y]);
    if (until([x, y])) break;
  }
  return points;
}

/** The physical geography of P1: one NE-trending range body on a tilted base. */
function mountainGeography() {
  const c = [750_000, 480_000],
    theta = (35 * Math.PI) / 180,
    u = [Math.cos(theta), Math.sin(theta)],
    n = [-Math.sin(theta), Math.cos(theta)],
    across: Field = (x, y) => (x - c[0]) * n[0] + (y - c[1]) * n[1],
    along: Field = (x, y) => (x - c[0]) * u[0] + (y - c[1]) * u[1],
    fade = (s: number) => clamp01((700_000 - Math.abs(s)) / 150_000),
    base = (y: number) => (y < 180_000 ? -150 + (y / 180_000) * 270 : 120 + (y - 180_000) * 0.0004),
    body: Field = (x, y) =>
      2000 *
      gaussian(across(x, y), 85_000) *
      (0.75 + 0.25 * Math.cos((2 * Math.PI * along(x, y)) / 350_000)) *
      fade(along(x, y)),
    elevation: Field = (x, y) => base(y) + body(x, y),
    windward = (x: number, y: number) => across(x, y) < 0,
    rainfall: Field = (x, y) =>
      windward(x, y) ? 1.3 + 0.6 * gaussian(across(x, y), 90_000) : 0.45,
    temperature: Field = (x, y) => 18 - 0.0065 * Math.max(0, elevation(x, y)) - y * 1.2e-5,
    glacial: Field = (x, y) =>
      60 * gaussian(across(x, y), 70_000) * clamp01((along(x, y) - 50_000) / 150_000),
    coherence: Field = (x, y) => clamp01(1.2 * gaussian(across(x, y), 120_000)) * fade(along(x, y)),
    tree: Field = (x, y) => {
      const h = elevation(x, y);
      if (h < 0) return 0;
      if (h > 1700) return 0.05;
      return windward(x, y) ? 0.65 : 0.35;
    },
    cover = (x: number, y: number) => {
      const h = elevation(x, y);
      if (h < 0) return "Ocean" as const;
      if (h > 2200) return "Barren" as const;
      if (h > 1700) return "Tundra" as const;
      return windward(x, y) ? ("Temperate forest" as const) : ("Woodland" as const);
    };
  return {
    c,
    theta,
    u,
    n,
    across,
    along,
    fade,
    elevation,
    windward,
    rainfall,
    temperature,
    glacial,
    coherence,
    tree,
    cover,
  };
}

/**
 * P1: a mountain country. One NE-trending range body (a smooth dome a dozen parent cells
 * wide), structural grain along it, a glaciated north-eastern half, a windward wet flank
 * facing a southern coast, a river from the crest to the sea with a foothill town, a
 * longitudinal river entering across the frame and an established summit.
 */
export function mountainCountry(): ParentSpec {
  const geo = mountainGeography(),
    { c, u, n, elevation, windward } = geo,
    sea = (p: [number, number]) => elevation(p[0], p[1]) < 0,
    vell = traceCourse(
      [c[0] - n[0] * 30_000 + u[0] * -100_000, c[1] - n[1] * 30_000 + u[1] * -100_000],
      [-n[0], -n[1]],
      parentSpacing,
      (k) => 0.05 * Math.sin(k / 3),
      sea
    ),
    ash = traceCourse(
      [1_000_000, parentHeight - 1],
      [-0.35, -0.94],
      parentSpacing,
      (k) => (k < 12 ? 0.06 : 0.015),
      (p) => p[0] < 300_000
    ),
    foothill = vell.find(([x, y]) => elevation(x, y) < 350) ?? vell[Math.floor(vell.length / 2)];
  return {
    name: "P1 mountain country",
    channels: mountainChannels(geo),
    courses: [
      { name: "Vell", points: vell, flow: (t) => 15 + 125 * t, order: 3 },
      { name: "Ash", points: ash, flow: (t) => 200 + 60 * t, order: 4 },
    ],
    towns: [{ name: "Harrowgate", position: foothill, population: 6000 }],
    peaks: [
      {
        name: "Mount Carrow",
        position: [c[0], c[1]],
        prominence: 1200,
        elevation: elevation(c[0], c[1]),
      },
    ],
    density: (x, y) => {
      const h = elevation(x, y);
      if (h < 0) return 0;
      if (h > 1200) return 0.3;
      return windward(x, y) ? 18 : 6;
    },
  };
}

function mountainChannels(geo: ReturnType<typeof mountainGeography>): ParentSpec["channels"] {
  const {
    theta,
    across,
    along,
    fade,
    elevation,
    windward,
    rainfall,
    temperature,
    glacial,
    coherence,
    tree,
    cover,
  } = geo;
  return {
    elevation: ["metre", elevation],
    rock: ["ratio", (x, y) => 1 + 0.5 * gaussian(across(x, y), 40_000)],
    fracture: ["ratio", (x, y) => 0.25 + 0.3 * gaussian(across(x, y), 60_000)],
    tectonicStrain: ["ratio", (x, y) => 0.7 * gaussian(across(x, y), 110_000) * fade(along(x, y))],
    structuralGrainX: ["ratio", (x, y) => Math.cos(2 * theta) * coherence(x, y)],
    structuralGrainY: ["ratio", (x, y) => Math.sin(2 * theta) * coherence(x, y)],
    glacialErosion: ["metre", glacial],
    temperature: ["celsius", temperature],
    rainfall: ["metre/year", rainfall],
    runoff: ["metre/year", (x, y) => 0.45 * rainfall(x, y)],
    moisture: ["ratio", (x, y) => clamp01(rainfall(x, y) / 1.6)],
    windEast: ["ratio", () => -0.55],
    windNorth: ["ratio", () => 0.6],
    soilDepth: ["metre", (x, y) => Math.max(0.1, 0.9 - 0.7 * gaussian(across(x, y), 90_000))],
    treeCover: ["ratio", tree],
    grassCover: ["ratio", (x, y) => (elevation(x, y) < 0 ? 0 : windward(x, y) ? 0.2 : 0.35)],
    wetlandCover: ["ratio", () => 0],
    biome: ["category", (x, y) => biomeCode(cover(x, y))],
    naturalSurface: ["category", (x, y) => surfaceCode(cover(x, y))],
    finalSurface: ["category", (x, y) => surfaceCode(cover(x, y))],
    water: ["category", (x, y) => (elevation(x, y) < 0 ? 1 : 0)],
    waterDepth: ["metre", (x, y) => Math.max(0, -elevation(x, y))],
    seaLevel: ["metre", () => 0],
    ice: ["ratio", () => 0],
  };
}

type Zone = "plateau" | "lowland" | "coast" | "sea";

/** The physical geography of P2: a caprock plateau with a basin and a cone above a coastal lowland. */
function plateauGeography() {
  const c = [750_000, 520_000],
    theta = (40 * Math.PI) / 180,
    u = [Math.cos(theta), Math.sin(theta)],
    n = [Math.sin(theta), -Math.cos(theta)],
    across: Field = (x, y) => (x - c[0]) * n[0] + (y - c[1]) * n[1],
    cone: Field = (x, y) => Math.hypot(x - 870_000, y - 640_000),
    basin: Field = (x, y) => Math.hypot(x - 600_000, y - 700_000),
    elevation: Field = (x, y) => {
      const t = across(x, y),
        plateau = 900 + 0.0002 * Math.max(0, -t) - 120 * gaussian(basin(x, y), 70_000),
        lowland =
          150 - 150 * clamp01((t - 200_000) / 80_000) - 60 * clamp01((t - 280_000) / 60_000),
        ramp = smoothstep((t + 30_000) / 60_000);
      return plateau * (1 - ramp) + lowland * ramp + 450 * gaussian(cone(x, y), 30_000);
    },
    zone = (x: number, y: number): Zone => {
      const t = across(x, y);
      if (t < -30_000) return "plateau";
      if (t < 200_000) return "lowland";
      return elevation(x, y) < 0 ? "sea" : "coast";
    },
    rainfall: Field = (x, y) =>
      ({ plateau: 0.22, lowland: 0.5, coast: 0.85, sea: 0.9 })[zone(x, y)],
    cover = (x: number, y: number) =>
      ({
        plateau: "Desert" as const,
        lowland: "Grassland" as const,
        coast: "Woodland" as const,
        sea: "Ocean" as const,
      })[zone(x, y)];
  return { c, u, n, cone, elevation, zone, rainfall, cover };
}

/**
 * P2: a dry plateau above an escarpment, a grassy lowland and a wooded coast. Hard caprock
 * on the plateau, soft lowland, no structural grain, no glacial history, one volcanic cone
 * on the plateau, an ephemeral river from the escarpment to a coastal town.
 */
export function plateauCountry(): ParentSpec {
  const geo = plateauGeography(),
    { c, u, n, elevation, zone } = geo,
    sea = (p: [number, number]) => elevation(p[0], p[1]) < 0,
    dunmere = traceCourse(
      [c[0] + u[0] * -80_000 + n[0] * 10_000, c[1] + u[1] * -80_000 + n[1] * 10_000],
      [n[0], n[1]],
      parentSpacing,
      (k) => 0.04 * Math.cos(k / 4),
      sea
    ),
    mouth = dunmere.at(-2) ?? dunmere.at(-1)!;
  return {
    name: "P2 plateau and coastal basin",
    channels: plateauChannels(geo),
    courses: [{ name: "Dunmere", points: dunmere, flow: (t) => 6 + 34 * t, order: 2 }],
    towns: [{ name: "Saltmere", position: mouth, population: 9000 }],
    peaks: [],
    density: (x, y) => ({ plateau: 0.2, lowland: 5, coast: 20, sea: 0 })[zone(x, y)],
  };
}

function plateauChannels(geo: ReturnType<typeof plateauGeography>): ParentSpec["channels"] {
  const { cone, elevation, zone, rainfall, cover } = geo;
  return {
    elevation: ["metre", elevation],
    rock: [
      "ratio",
      (x, y) => (zone(x, y) === "plateau" ? 1.7 : 0.8) + 0.4 * gaussian(cone(x, y), 30_000),
    ],
    fracture: ["ratio", (x, y) => (zone(x, y) === "plateau" ? 0.35 : 0.15)],
    tectonicStrain: ["ratio", () => 0.08],
    structuralGrainX: ["ratio", () => 0],
    structuralGrainY: ["ratio", () => 0],
    glacialErosion: ["metre", () => 0],
    volcanicConstruction: ["metre", (x, y) => 500 * gaussian(cone(x, y), 25_000)],
    temperature: ["celsius", (x, y) => 24 - 0.0065 * Math.max(0, elevation(x, y))],
    rainfall: ["metre/year", rainfall],
    runoff: ["metre/year", (x, y) => 0.3 * rainfall(x, y)],
    moisture: ["ratio", (x, y) => clamp01(rainfall(x, y) / 1.2)],
    windEast: ["ratio", () => -0.4],
    windNorth: ["ratio", () => 0.7],
    soilDepth: ["metre", (x, y) => (zone(x, y) === "plateau" ? 0.25 : 1.1)],
    treeCover: [
      "ratio",
      (x, y) => ({ plateau: 0.03, lowland: 0.25, coast: 0.55, sea: 0 })[zone(x, y)],
    ],
    grassCover: [
      "ratio",
      (x, y) => ({ plateau: 0.25, lowland: 0.4, coast: 0.3, sea: 0 })[zone(x, y)],
    ],
    wetlandCover: ["ratio", () => 0],
    biome: ["category", (x, y) => biomeCode(cover(x, y))],
    naturalSurface: ["category", (x, y) => surfaceCode(cover(x, y))],
    finalSurface: ["category", (x, y) => surfaceCode(cover(x, y))],
    water: ["category", (x, y) => (elevation(x, y) < 0 ? 1 : 0)],
    waterDepth: ["metre", (x, y) => Math.max(0, -elevation(x, y))],
    seaLevel: ["metre", () => 0],
    ice: ["ratio", () => 0],
  };
}

/** The constructed parents' fixed regional selections (metres, world coordinates). */
export const constructedSelections: Record<"P1" | "P2", [number, number, number, number]> = {
  P1: [480_000, 280_000, 1_020_000, 680_000],
  P2: [500_000, 320_000, 1_040_000, 720_000],
};
