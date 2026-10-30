import { expect, vi } from "vitest";
import {
  regionRefinementInput,
  refinedRegionArea,
  type DomainSnapshot,
  type SocietyCommunity,
  createGrid,
  generateBand,
  gridPosition,
  putChannel,
} from "@atlas/domain";
import { generationSnapshot, atlasPublicationDefinitions } from "@atlas/generation";
import {
  fixtureState,
  commitCommand,
  fixtureWorkspace,
  registerWorldSnapshot,
  createWorldSnapshot,
} from "./workspaceFixture";
import { constructedWorld } from "../constructedWorldFixture";

export async function refinementFixture(width?: number) {
  const constructed = width ? suppliedIsland(width) : constructedWorld(),
    parent = generationSnapshot(constructed.result, constructed.input, crypto.randomUUID());
  supplyRefinementSociety(parent);
  const scale = width ? width / 4000 : 1;
  const poi = crypto.randomUUID();
  parent.world.features[poi] = {
    id: poi,
    areaId: parent.scope.areaId,
    layerId: "magic",
    kind: "fire:core",
    name: "Known inland core",
    geometry: { type: "Point", coordinates: [2600 * scale, 300 * scale] },
    attributes: { intensity: 500 },
    relations: [],
    causes: [],
    detail: {},
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    generationDomain: "magic",
  };
  if (width) {
    const society = parent.world.societies![parent.scope.areaId],
      c = society.communities[0];
    c.position = { x: 2500 * scale, y: 300 * scale, z: 0 };
    c.groups[0].count = 2_000_000;
    c.settlement!.population = 15000;
    c.latentSettlementPopulation = 200000;
    c.areaKm2 = width ** 2 / 4e6;
    society.works = [];
    society.events = [];
  }
  registerWorldSnapshot(parent);
  const id = parent.world.id,
    root = parent.scope.areaId,
    current = () => fixtureState(id).snapshot,
    command = (kind: string, data: Record<string, unknown>) =>
      commitCommand(id, {
        operationId: crypto.randomUUID(),
        expectedVersion: current().world.version,
        kind,
        data,
      }),
    regionId = crypto.randomUUID();
  await command("putView", {
    id: regionId,
    name: "Closer coast",
    areaId: root,
    layers: [],
    region: {
      parentId: null,
      footprint: {
        type: "Polygon",
        coordinates: [
          [
            [1000 * scale, 100 * scale],
            [3000 * scale, 100 * scale],
            [3000 * scale, 900 * scale],
            [1000 * scale, 100 * scale],
          ],
        ],
      },
    },
  });
  await command("createArea", regionRefinementInput(current().world, regionId));
  const child = refinedRegionArea(current().world, regionId)!.id,
    workspace = await fixtureWorkspace(id);
  return { id, root, child, workspace, current, parent };
}
/** Coarse terrain, weather and residents are inputs; no upstream generator establishes them. */
function suppliedIsland(width: number) {
  const source = createWorldSnapshot({
      name: "Supplied regional island",
      seed: 73,
      width,
      height: width / 4,
    }),
    input = { areaId: source.scope.areaId, seed: 73, quality: "draft", domains: ["physical"] },
    surface = createGrid("supplied-island", source.scope, 33, 9);
  surface.scope.resolution = width / 32;
  const values: Record<string, [string, (x: number, y: number) => number]> = {
    elevation: [
      "metre",
      (x, y) =>
        500 * (1 - ((x - 0.5) / 0.39) ** 2 - ((y - 0.5) / 0.4) ** 2) +
        150 * Math.sin(x * Math.PI * 4),
    ],
    temperature: ["celsius", () => 16],
    moisture: ["ratio", () => 0.7],
    rainfall: ["metre/year", () => 1.2],
    runoff: ["metre/year", () => 0.7],
    windEast: ["ratio", () => 0.8],
    windNorth: ["ratio", () => 0.2],
    soilDepth: ["metre", () => 1],
  };
  for (const [name, [unit, value]] of Object.entries(values))
    putChannel(
      surface,
      name,
      unit,
      generateBand(surface.coverage, "float64", name, (i) => {
        const p = gridPosition(surface, i);
        return value(p.x / width, p.y / (width / 4));
      })
    );
  return {
    source,
    input,
    result: {
      kind: "final" as const,
      configurationHash: "supplied-island",
      ancestry: [],
      state: {
        domain: source,
        surface,
        facts: new Set(Object.keys(values)),
        history: [],
        publications: atlasPublicationDefinitions(input, source.world),
      },
    },
  };
}
function supplyRefinementSociety(parent: DomainSnapshot) {
  const root = parent.scope.areaId,
    community = crypto.randomUUID();
  parent.world.societies = {
    [root]: {
      areaId: root,
      spaceId: parent.scope.spaceId,
      communities: [suppliedCommunity(community, parent.scope.footprint)],
      history: [
        {
          id: "Earlier era",
          years: 100,
          before: 1000,
          births: 0,
          deaths: 0,
          migrated: 0,
          after: 1000,
          causes: [],
        },
      ],
      works: [
        {
          id: crypto.randomUUID(),
          communityId: community,
          name: "Inherited clearance",
          kind: "clearance",
          position: { x: 2500, y: 300, z: 0 },
          radius: 200,
          magnitude: 1,
          condition: 1,
          maintained: true,
          authored: false,
          built: "Earlier era",
          applied: 1,
          demand: { amount: 0.2, unit: "fraction" },
          causes: [],
        },
      ],
      events: [
        {
          id: crypto.randomUUID(),
          era: "Earlier era",
          kind: "migration",
          position: { x: 3500, y: 500, z: 0 },
          radius: 1000,
          magnitude: 1,
          casualties: 0,
          displaced: 100,
          communities: [community],
          causes: [],
        },
      ],
      connections: [],
      magic: [],
    },
  };
}
function suppliedCommunity(id: string, footprint: SocietyCommunity["footprint"]): SocietyCommunity {
  return {
    id,
    name: "Known town",
    position: { x: 2500, y: 300, z: 0 },
    areaKm2: 4,
    footprint,
    groups: [
      {
        people: "residents",
        culture: null,
        languages: [],
        religions: [],
        practices: [],
        count: 1000,
      },
    ],
    support: {
      farming: 1000,
      grazing: 0,
      gathering: 0,
      fishing: 0,
      water: 1,
      capacity: 1000,
    },
    founded: "Earlier era",
    status: "inhabited",
    protected: false,
    causes: [],
    settlement: { population: 300, peak: 300, recoveryYears: 0 },
  };
}
export function denyParentReads(
  workspace: Awaited<ReturnType<typeof fixtureWorkspace>>,
  child: string,
  parentFields: Set<string>
) {
  const originalRead = workspace.catalog.readAuthoring.bind(workspace.catalog);
  const deny = vi.spyOn(workspace.catalog, "readAuthoring").mockImplementation(async (request) => {
    expect(request.scope.areaId).toBe(child);
    expect(request.channels.some((field) => parentFields.has(field.fieldId))).toBe(false);
    const snapshot = await originalRead(request);
    expect(snapshot.world.fields.every((field) => field.areaId === child)).toBe(true);
    expect(
      Object.values(snapshot.world.features).every((feature) => feature.areaId === child)
    ).toBe(true);
    return snapshot;
  });
  return deny;
}
export function numericalReads(source: DomainSnapshot) {
  return {
    scope: source.scope,
    objects: [],
    channels: source.world.fields.map((field) => ({
      fieldId: field.id,
      names: field.channels ?? [],
    })),
    spatialLayers: [],
    parentHistory: [],
    dependencies: false,
  };
}
