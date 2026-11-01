import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import {
  biomeCode,
  builtinLayers,
  createGrid,
  generateBand,
  gridPosition,
  putChannel,
  rectangle,
  regionRefinementInput,
  refinedRegionArea,
  spatial,
  surfaceCode,
  type AtlasFeature,
  type DomainSnapshot,
  type Grid,
  type SocietyCommunity,
} from "@atlas/domain";
import {
  atlasPublicationDefinitions,
  generateAtlas,
  generationSnapshot,
  refineRegionalMap,
  type CompletedBoundary,
} from "@atlas/generation";
import { generationStorageFixture } from "../../../packages/storage-browser/src/generationFixture";
import { newGenerationDraft, prepareDraft } from "../generationDraft";
import { createWorldSnapshot } from "../worldCreation";
import { executeWorkspaceCommand } from "../workspaceCommands";
import { fixtureState, fixtureWorkspace, registerWorldSnapshot } from "./workspaceFixture";
import { regionalWorkload, type RegionalWorkloadOutput } from "./regionalWorkload";
import { regionalOverview, regionalReliefOverview } from "./regionalOverview";

/**
 * The frozen regional evaluation (spec section 9.1): four paired cases, one fixed seed,
 * fixed selections and one fixed presentation. P1 and P2 are constructed at the coarse
 * world sampling scale; M1 and M2 are selected from one generated draft world by their
 * parent conditions. The variant name separates baseline renders from candidate renders.
 */
export const evaluationSeed = 73;
export const evaluationDirectory = ".artifacts/regional/evaluation";
export const evaluationVariant = process.env.ATLAS_REGIONAL_VARIANT ?? "candidate";
/** World sampling of the constructed parents: the default world's 200 km² cells. */
const parentSpacing = Math.sqrt(200e6);
const parentWidth = 1_500_000,
  parentHeight = 1_000_000;

type Fixture = Parameters<typeof regionalWorkload>[0];
export interface CaseRecord {
  case: string;
  variant: string;
  samples: number;
  runsMs: number[];
  medianMs: number;
  deterministic: boolean;
  counts: Record<string, number>;
  phases?: Record<string, number>;
  note?: string;
}

/** Axis-aligned frame helpers shared by the constructed parents. */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const gaussian = (d: number, width: number) => Math.exp(-((d / width) ** 2));

interface Course {
  name: string;
  points: [number, number][];
  flow: (t: number) => number;
  order: number;
}
interface Town {
  name: string;
  position: [number, number];
  population: number;
}
interface ParentSpec {
  name: string;
  channels: Record<string, [string, (x: number, y: number) => number]>;
  courses: Course[];
  towns: Town[];
  peaks: { name: string; position: [number, number]; prominence: number; elevation: number }[];
  density: (x: number, y: number) => number;
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

/**
 * P1: a mountain country. One NE-trending range body (a smooth dome a dozen parent cells
 * wide), structural grain along it, a glaciated north-eastern half, a windward wet flank
 * facing a southern coast, a river from the crest to the sea with a foothill town, a
 * longitudinal river entering across the frame and an established summit.
 */
export function mountainCountry(): ParentSpec {
  const c = [750_000, 480_000],
    theta = (35 * Math.PI) / 180,
    u = [Math.cos(theta), Math.sin(theta)],
    n = [-Math.sin(theta), Math.cos(theta)],
    across = (x: number, y: number) => (x - c[0]) * n[0] + (y - c[1]) * n[1],
    along = (x: number, y: number) => (x - c[0]) * u[0] + (y - c[1]) * u[1],
    fade = (s: number) => clamp01((700_000 - Math.abs(s)) / 150_000),
    base = (y: number) => (y < 180_000 ? -150 + (y / 180_000) * 270 : 120 + (y - 180_000) * 0.0004),
    body = (x: number, y: number) =>
      2000 *
      gaussian(across(x, y), 85_000) *
      (0.75 + 0.25 * Math.cos((2 * Math.PI * along(x, y)) / 350_000)) *
      fade(along(x, y)),
    elevation = (x: number, y: number) => base(y) + body(x, y),
    windward = (x: number, y: number) => across(x, y) < 0,
    rainfall = (x: number, y: number) =>
      windward(x, y) ? 1.3 + 0.6 * gaussian(across(x, y), 90_000) : 0.45,
    temperature = (x: number, y: number) => 18 - 0.0065 * Math.max(0, elevation(x, y)) - y * 1.2e-5,
    glacial = (x: number, y: number) =>
      60 * gaussian(across(x, y), 70_000) * clamp01((along(x, y) - 50_000) / 150_000),
    coherence = (x: number, y: number) =>
      clamp01(1.2 * gaussian(across(x, y), 120_000)) * fade(along(x, y)),
    tree = (x: number, y: number) => {
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
  const sea = (p: [number, number]) => elevation(p[0], p[1]) < 0,
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
    channels: {
      elevation: ["metre", elevation],
      rock: ["ratio", (x, y) => 1 + 0.5 * gaussian(across(x, y), 40_000)],
      fracture: ["ratio", (x, y) => 0.25 + 0.3 * gaussian(across(x, y), 60_000)],
      tectonicStrain: [
        "ratio",
        (x, y) => 0.7 * gaussian(across(x, y), 110_000) * fade(along(x, y)),
      ],
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
    },
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

/**
 * P2: a dry plateau above an escarpment, a grassy lowland and a wooded coast. Hard caprock
 * on the plateau, soft lowland, no structural grain, no glacial history, one volcanic cone
 * on the plateau, an ephemeral river from the escarpment to a coastal town.
 */
export function plateauCountry(): ParentSpec {
  const c = [750_000, 520_000],
    theta = (40 * Math.PI) / 180,
    u = [Math.cos(theta), Math.sin(theta)],
    n = [Math.sin(theta), -Math.cos(theta)],
    across = (x: number, y: number) => (x - c[0]) * n[0] + (y - c[1]) * n[1],
    cone = (x: number, y: number) => Math.hypot(x - 870_000, y - 640_000),
    basin = (x: number, y: number) => Math.hypot(x - 600_000, y - 700_000),
    elevation = (x: number, y: number) => {
      const t = across(x, y),
        plateau = 900 + 0.0002 * Math.max(0, -t) - 120 * gaussian(basin(x, y), 70_000),
        lowland =
          150 - 150 * clamp01((t - 200_000) / 80_000) - 60 * clamp01((t - 280_000) / 60_000),
        ramp = smoothstep((t + 30_000) / 60_000);
      return plateau * (1 - ramp) + lowland * ramp + 450 * gaussian(cone(x, y), 30_000);
    },
    zone = (x: number, y: number) => {
      const t = across(x, y);
      return t < -30_000
        ? "plateau"
        : t < 200_000
          ? "lowland"
          : elevation(x, y) < 0
            ? "sea"
            : "coast";
    },
    rainfall = (x: number, y: number) =>
      ({ plateau: 0.22, lowland: 0.5, coast: 0.85, sea: 0.9 })[zone(x, y)],
    cover = (x: number, y: number) =>
      ({
        plateau: "Desert" as const,
        lowland: "Grassland" as const,
        coast: "Woodland" as const,
        sea: "Ocean" as const,
      })[zone(x, y)];
  const sea = (p: [number, number]) => elevation(p[0], p[1]) < 0,
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
    channels: {
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
    },
    courses: [{ name: "Dunmere", points: dunmere, flow: (t) => 6 + 34 * t, order: 2 }],
    towns: [{ name: "Saltmere", position: mouth, population: 9000 }],
    peaks: [],
    density: (x, y) => ({ plateau: 0.2, lowland: 5, coast: 20, sea: 0 })[zone(x, y)],
  };
}

/** The constructed parents' fixed regional selections (metres, world coordinates). */
export const constructedSelections: Record<"P1" | "P2", [number, number, number, number]> = {
  P1: [480_000, 280_000, 1_020_000, 680_000],
  P2: [500_000, 320_000, 1_040_000, 720_000],
};

function supplyParentWorld(spec: ParentSpec) {
  const source = createWorldSnapshot({
      name: spec.name,
      seed: evaluationSeed,
      width: parentWidth,
      height: parentHeight,
    }),
    input = {
      areaId: source.scope.areaId,
      seed: evaluationSeed,
      quality: "draft",
      domains: ["physical", "built"],
    },
    surface = createGrid(
      "supplied-parent",
      source.scope,
      Math.ceil(parentWidth / parentSpacing) + 1,
      Math.ceil(parentHeight / parentSpacing) + 1
    );
  surface.scope.resolution = parentSpacing;
  const values: ParentSpec["channels"] = {
    ...spec.channels,
    populationDensity: ["people/square-kilometre", spec.density],
  };
  for (const [name, [unit, value]] of Object.entries(values))
    putChannel(
      surface,
      name,
      unit,
      generateBand(surface.coverage, "float64", name, (i) => {
        const p = gridPosition(surface, i);
        return value(p.x, p.y);
      }),
      unit === "category" ? "category" : "intensive"
    );
  supplyCourses(surface, spec.courses);
  // The structural grain channels are part of the frozen parent whether or not the
  // generator of the running revision publishes them.
  const publications = atlasPublicationDefinitions(input, source.world),
    geology = builtinLayers().find((layer) => layer.id === "geology")!,
    population = {
      ...builtinLayers().find((layer) => layer.id === "cultures")!,
      id: "population",
      name: "Population and livelihoods",
      facts: ["populationDensity", "populationCapacity"],
    };
  for (const [channel, unit, layer] of [
    ["structuralGrainX", "ratio", geology],
    ["structuralGrainY", "ratio", geology],
    ["populationDensity", "people/square-kilometre", population],
  ] as const)
    if (!publications.some((d) => d.kind === "field" && d.channel === channel))
      publications.push({ kind: "field", channel, unit, quantity: "intensive", layer });
  const result: CompletedBoundary = {
    kind: "final",
    configurationHash: "supplied-parent",
    ancestry: [],
    state: {
      domain: source,
      surface,
      facts: new Set(Object.keys(values)),
      history: [],
      publications,
    },
  };
  const parent = generationSnapshot(result, input, crypto.randomUUID()),
    root = parent.scope.areaId;
  supplyFeatures(parent, root, spec);
  return parent;
}

/** River channels on the parent samples: order, discharge and catchment along each course. */
function supplyCourses(surface: Grid, courses: Course[]) {
  const order = generateBand(surface.coverage, "float64", "riverOrder", () => 0),
    flow = generateBand(surface.coverage, "float64", "flow", () => 0),
    catchment = generateBand(surface.coverage, "float64", "catchmentArea", (i) =>
      surface.measures.get(i)
    );
  for (const course of courses)
    course.points.forEach(([x, y], k) => {
      const t = k / Math.max(1, course.points.length - 1);
      for (let i = 0; i < surface.active.length; i++) {
        const p = gridPosition(surface, i);
        if (Math.hypot(p.x - x, p.y - y) > parentSpacing * 0.55) continue;
        order.set(i, Math.max(order.get(i), course.order));
        flow.set(i, Math.max(flow.get(i), course.flow(t)));
        catchment.set(i, Math.max(catchment.get(i), course.flow(t) * 2e7));
      }
    });
  putChannel(surface, "riverOrder", "category", order, "category");
  putChannel(surface, "flow", "cubic-metre/second", flow);
  putChannel(surface, "catchmentArea", "square-metre", catchment);
}

function supplyFeatures(parent: DomainSnapshot, root: string, spec: ParentSpec) {
  const feature = (
    id: string,
    kind: string,
    layerId: string,
    name: string,
    geometry: AtlasFeature["geometry"],
    attributes: Record<string, unknown>,
    domain: string
  ): AtlasFeature => ({
    id,
    areaId: root,
    layerId,
    kind,
    name,
    geometry,
    attributes,
    relations: [],
    causes: [],
    detail: {},
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    generationDomain: domain,
  });
  for (const course of spec.courses) {
    const discharges = course.points.map((_, k) =>
      course.flow(k / Math.max(1, course.points.length - 1))
    );
    parent.world.features[`river:${course.name}`] = feature(
      `river:${course.name}`,
      "river",
      "rivers",
      course.name,
      { type: "LineString", coordinates: course.points.map(([x, y]) => [x, y]) },
      {
        discharge: discharges.at(-1),
        order: course.order,
        discharges,
        widths: discharges.map((q) => 3 * Math.sqrt(q)),
        nameStatus: "proper",
      },
      "physical"
    );
  }
  for (const peak of spec.peaks)
    parent.world.features[`peak:${peak.name}`] = feature(
      `peak:${peak.name}`,
      "peak",
      "geology",
      peak.name,
      { type: "Point", coordinates: peak.position },
      { prominence: peak.prominence, elevation: peak.elevation, nameStatus: "proper" },
      "physical"
    );
  const communities: SocietyCommunity[] = spec.towns.map((town, index) => {
    const id = `community:${index}`,
      [x, y] = town.position;
    parent.world.features[`settlement:${town.name}`] = feature(
      `settlement:${town.name}`,
      "settlement",
      "settlements",
      town.name,
      { type: "Point", coordinates: [x, y] },
      {
        population: town.population,
        settlementPopulation: town.population,
        communityId: id,
        status: "inhabited",
        scale: "town",
        nameStatus: "proper",
      },
      "built"
    );
    return {
      id,
      name: town.name,
      position: { x, y, z: 0 },
      areaKm2: 2800,
      footprint: spatial.buffer({ type: "Point", coordinates: [x, y] }, 30_000)!,
      groups: [
        {
          people: "residents",
          culture: null,
          languages: [],
          religions: [],
          practices: [],
          count: 40_000,
        },
      ],
      support: {
        farming: 30_000,
        grazing: 5000,
        gathering: 2000,
        fishing: 3000,
        water: 1,
        capacity: 45_000,
      },
      founded: "Earlier era",
      status: "inhabited",
      protected: false,
      causes: [],
      settlement: { population: town.population, peak: town.population, recoveryYears: 0 },
      latentSettlementPopulation: 0,
    };
  });
  parent.world.societies = {
    [root]: {
      areaId: root,
      spaceId: parent.scope.spaceId,
      communities,
      history: [
        {
          id: "Earlier era",
          years: 300,
          before: 40_000,
          births: 0,
          deaths: 0,
          migrated: 0,
          after: 40_000,
          causes: [],
        },
      ],
      works: [],
      events: [],
      connections: [],
      magic: [],
    },
  };
}

async function selectRegion(
  parent: DomainSnapshot,
  workspace: Awaited<ReturnType<typeof fixtureWorkspace>>,
  name: string,
  footprint: ReturnType<typeof rectangle>
): Promise<Fixture> {
  const id = parent.world.id,
    root = parent.scope.areaId,
    regionId = crypto.randomUUID(),
    scope = { worldId: id, areaId: root, spaceId: parent.scope.spaceId };
  let world = await workspace.catalog.readEditor(id);
  const command = async (kind: string, data: Record<string, unknown>) => {
    await executeWorkspaceCommand(
      workspace.catalog,
      workspace.resources,
      {
        scope,
        preview: false,
        command: { operationId: crypto.randomUUID(), expectedVersion: world.version, kind, data },
      },
      workspace.working.cache
    );
    world = await workspace.catalog.readEditor(id);
  };
  await command("putView", {
    id: regionId,
    name,
    areaId: root,
    layers: [],
    region: { parentId: null, footprint },
  });
  await command("createArea", regionRefinementInput(world, regionId));
  const child = refinedRegionArea(world, regionId)!.id;
  return { id, root, child, workspace, parent, current: () => fixtureState(id).snapshot };
}

/** P1 or P2 through the real selection and capture path. */
export async function constructedCase(id: "P1" | "P2") {
  const parent = supplyParentWorld(id === "P1" ? mountainCountry() : plateauCountry());
  registerWorldSnapshot(parent);
  const workspace = await fixtureWorkspace(parent.world.id);
  return selectRegion(parent, workspace, id, rectangle(constructedSelections[id]));
}

/** One generated draft world shared by the magical cases; the production handoff path. */
export async function generatedWorld() {
  const storage = await generationStorageFixture(),
    draft = newGenerationDraft();
  draft.width = 2_000_000;
  draft.height = 1_000_000;
  draft.recipe.quality = "draft";
  draft.recipe.seed = evaluationSeed;
  draft.recipe.domains = ["physical", "magic", "cultural", "political", "built"];
  const prepared = prepareDraft(draft);
  expect(prepared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  storage.source(prepared.source);
  const started = performance.now(),
    result = await generateAtlas(prepared.source, prepared.input, storage.options),
    worldMs = performance.now() - started,
    published = generationSnapshot(result, prepared.input, "evaluation-world", prepared.source);
  published.world.features = Object.fromEntries(
    [...storage.options.features.values()].map((feature) => [feature.id, feature])
  );
  registerWorldSnapshot(published);
  const workspace = await fixtureWorkspace(published.world.id);
  return {
    published,
    surface: result.state.surface,
    worldMs,
    workspace,
    close: () => storage.close(),
  };
}

/**
 * Select a magical case by its parent conditions. Candidate frames of the case's size are
 * placed on a 50 km lattice; a frame qualifies by its land share (mostly land inland, a
 * coast of 35–85 % land when coastal) and by carrying the named systems; the frame with the
 * most of their coverage wins. When no frame carries every named system, the frame with the
 * most of them present wins and the missing ones are recorded.
 */
export function magicSelection(
  surface: Grid,
  systems: string[],
  coastal: boolean,
  halfSize: [number, number]
) {
  const bin = 50_000,
    [w, s, e, n] = surface.bounds,
    columns = Math.ceil((e - w) / bin),
    rows = Math.ceil((n - s) / bin),
    totals = systems.map(() => new Float64Array(columns * rows)),
    land = new Float64Array(columns * rows),
    cells = new Float64Array(columns * rows);
  for (let i = 0; i < surface.active.length; i++) {
    const p = gridPosition(surface, i),
      k =
        Math.min(rows - 1, Math.floor((p.y - s) / bin)) * columns +
        Math.min(columns - 1, Math.floor((p.x - w) / bin));
    cells[k]++;
    if (surface.channels.water.get(i) !== 1) land[k]++;
    systems.forEach((id, index) => {
      const coverage = surface.channels[`magic:${id}:coverage`]?.get(i) ?? 0;
      totals[index][k] += coverage;
    });
  }
  const reachX = Math.round(halfSize[0] / bin),
    reachY = Math.round(halfSize[1] / bin),
    frame = (cx: number, cy: number) => {
      const sums = systems.map(() => 0);
      let landCells = 0,
        allCells = 0;
      for (let y = cy - reachY; y < cy + reachY; y++)
        for (let x = cx - reachX; x < cx + reachX; x++) {
          if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
          const k = y * columns + x;
          landCells += land[k];
          allCells += cells[k];
          systems.forEach((_, index) => (sums[index] += totals[index][k]));
        }
      return { share: landCells / Math.max(1, allCells), sums };
    };
  let best: { cx: number; cy: number; sums: number[] } | undefined,
    bestKey = [-1, -1];
  for (let cy = reachY; cy <= rows - reachY; cy++)
    for (let cx = reachX; cx <= columns - reachX; cx++) {
      const { share, sums } = frame(cx, cy);
      if (coastal ? share < 0.35 || share > 0.85 : share < 0.7) continue;
      const present = sums.filter((sum) => sum > 0).length,
        value = sums.reduce((sum, total) => sum + Math.log1p(total), 0);
      if (present > bestKey[0] || (present === bestKey[0] && value > bestKey[1])) {
        bestKey = [present, value];
        best = { cx, cy, sums };
      }
    }
  expect(best).toBeDefined();
  const x = w + best!.cx * bin,
    y = s + best!.cy * bin,
    present = systems.filter((_, index) => best!.sums[index] > 0);
  return {
    footprint: rectangle([x - halfSize[0], y - halfSize[1], x + halfSize[0], y + halfSize[1]]),
    present,
  };
}

export async function generatedCase(
  world: Awaited<ReturnType<typeof generatedWorld>>,
  id: "M1" | "M2"
) {
  const systems = id === "M1" ? ["fire", "aurora"] : ["pressure", "greenwood", "salt", "hallowed"],
    selection = magicSelection(world.surface, systems, id === "M2", [200_000, 150_000]),
    fixture = await selectRegion(world.published, world.workspace, id, selection.footprint);
  return { fixture, present: selection.present, systems };
}

/** Three runs of one captured case: the median time, a determinism check and the renders. */
export async function evaluateCase(f: Fixture, id: string, note?: string): Promise<CaseRecord> {
  const runs: RegionalWorkloadOutput[] = [];
  let rendered: { result: CompletedBoundary; features: AtlasFeature[] } | undefined;
  for (let run = 0; run < 3; run++) {
    const workload = await regionalWorkload(f, f.child, "standard");
    try {
      const result = await refineRegionalMap(workload.source, workload.input, workload.options),
        output = await workload.publish(result);
      runs.push(output);
      if (run === 0) rendered = { result, features: [...workload.features.values()] };
    } finally {
      await workload.close();
    }
    if (run === 0 && rendered) {
      const directory = `${evaluationDirectory}/${evaluationVariant}`;
      await regionalOverview(rendered.result, rendered.features, `${id}-overview`, directory);
      await regionalReliefOverview(rendered.result, `${id}-relief`, directory);
    }
  }
  const times = runs.map((run) => run.generationMs).sort((a, b) => a - b),
    signatures = runs.map((run) => JSON.stringify(run.signature));
  return {
    case: id,
    variant: evaluationVariant,
    samples: runs[0].samples,
    runsMs: times,
    medianMs: times[1],
    deterministic: signatures.every((signature) => signature === signatures[0]),
    counts: runs[0].counts,
    phases: Object.fromEntries(
      Object.entries(runs[0].phases).map(([phase, ms]) => [phase, Math.round(ms)])
    ),
    ...(note ? { note } : {}),
  };
}

/** Records merge by case, so a partial rerun keeps the other cases' numbers. */
export async function writeEvaluationReport(records: CaseRecord[], worldMs: number | null) {
  const directory = `${evaluationDirectory}/${evaluationVariant}`,
    path = `${directory}/report.json`;
  await mkdir(directory, { recursive: true });
  let previous: { worldMs: number | null; cases: CaseRecord[] } = { worldMs: null, cases: [] };
  try {
    previous = JSON.parse(await readFile(path, "utf8"));
  } catch {
    // No earlier report for this variant.
  }
  const cases = [
    ...previous.cases.filter((record) => !records.some((next) => next.case === record.case)),
    ...records,
  ].sort((a, b) => a.case.localeCompare(b.case));
  await writeFile(
    path,
    JSON.stringify(
      {
        variant: evaluationVariant,
        seed: evaluationSeed,
        worldMs: worldMs ?? previous.worldMs,
        cases,
      },
      null,
      2
    )
  );
}
