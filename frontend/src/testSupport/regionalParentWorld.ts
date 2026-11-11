import {
  builtinLayers,
  createGrid,
  generateBand,
  gridPosition,
  putChannel,
  spatial,
  canonicalPhysicalFields,
  fieldChannelName,
  type AtlasFeature,
  type DomainSnapshot,
  type Grid,
  type SocietyCommunity,
} from "@atlas/domain";
import {
  atlasPublicationDefinitions,
  generationSnapshot,
  type CompletedBoundary,
} from "@atlas/generation";
import { createWorldSnapshot } from "../worldCreation";
import {
  evaluationSeed,
  parentHeight,
  parentSpacing,
  parentWidth,
  type Course,
  type ParentSpec,
  type Town,
} from "./regionalParents";

/** A constructed parent as a published world: supplied fields, river raster and features. */
export function supplyParentWorld(spec: ParentSpec) {
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
      fieldChannelName(name),
      unit,
      generateBand(
        surface.coverage,
        canonicalPhysicalFields().find((field) => field.name === name)?.type ?? "float64",
        name,
        (i) => {
          const p = gridPosition(surface, i);
          return value(p.x, p.y);
        }
      ),
      unit === "category" ? "category" : "intensive"
    );
  supplyCourses(surface, spec.courses);
  const result: CompletedBoundary = {
    kind: "final",
    configurationHash: "supplied-parent",
    ancestry: [],
    state: {
      domain: source,
      surface,
      facts: new Set(Object.keys(values)),
      history: [],
      publications: parentPublications(input, source),
    },
  };
  const parent = generationSnapshot(result, input, crypto.randomUUID()),
    root = parent.scope.areaId;
  supplyFeatures(parent, root, spec);
  return parent;
}

/**
 * The structural grain and population channels are part of the frozen parent whether or
 * not the generator of the running revision publishes them.
 */
function parentPublications(
  input: Parameters<typeof atlasPublicationDefinitions>[0],
  source: DomainSnapshot
) {
  const publications = atlasPublicationDefinitions(input, source.world),
    geology = builtinLayers().find((layer) => layer.id === "geology")!,
    population = {
      ...builtinLayers().find((layer) => layer.id === "cultures")!,
      id: "population",
      name: "Population and livelihoods",
      facts: ["populationDensity", "populationCapacity"],
    };
  for (const [channel, unit, layer] of [
    ["StructuralGrainX", "per-mille", geology],
    ["StructuralGrainY", "per-mille", geology],
    ["populationDensity", "people/square-kilometre", population],
  ] as const)
    if (!publications.some((d) => d.kind === "field" && d.channel === channel))
      publications.push({ kind: "field", channel, unit, quantity: "intensive", layer });
  return publications;
}

/** River channels on the parent samples: order, discharge and catchment along each course. */
function supplyCourses(surface: Grid, courses: Course[]) {
  const order = generateBand(surface.coverage, "int32", "RiverOrders", () => 0),
    flow = generateBand(surface.coverage, "float32", "FlowAccumulation", () => 0),
    catchment = generateBand(surface.coverage, "float32", "CatchmentArea", (i) =>
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
  putChannel(surface, "RiverOrders", "category", order, "category");
  putChannel(surface, "FlowAccumulation", "cubic-metre/second", flow);
  putChannel(surface, "CatchmentArea", "square-metre", catchment);
}

function supplied(
  root: string,
  id: string,
  kind: string,
  layerId: string,
  name: string,
  geometry: AtlasFeature["geometry"],
  attributes: Record<string, unknown>,
  domain: string
): AtlasFeature {
  return {
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
  };
}

function supplyFeatures(parent: DomainSnapshot, root: string, spec: ParentSpec) {
  for (const course of spec.courses) {
    const discharges = course.points.map((_, k) =>
      course.flow(k / Math.max(1, course.points.length - 1))
    );
    parent.world.features[`river:${course.name}`] = supplied(
      root,
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
    parent.world.features[`peak:${peak.name}`] = supplied(
      root,
      `peak:${peak.name}`,
      "peak",
      "geology",
      peak.name,
      { type: "Point", coordinates: peak.position },
      { prominence: peak.prominence, elevation: peak.elevation, nameStatus: "proper" },
      "physical"
    );
  const communities = spec.towns.map((town, index) => supplyTown(parent, root, town, index));
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

/** A town as the settlement feature and the community behind it. */
function supplyTown(
  parent: DomainSnapshot,
  root: string,
  town: Town,
  index: number
): SocietyCommunity {
  const id = `community:${index}`,
    [x, y] = town.position;
  parent.world.features[`settlement:${town.name}`] = supplied(
    root,
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
}
