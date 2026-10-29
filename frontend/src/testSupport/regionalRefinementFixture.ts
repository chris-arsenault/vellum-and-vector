import { expect, vi } from "vitest";
import {
  regionRefinementInput,
  refinedRegionArea,
  type DomainSnapshot,
  type SocietyCommunity,
} from "@atlas/domain";
import { generationSnapshot } from "@atlas/generation";
import {
  fixtureState,
  commitCommand,
  fixtureWorkspace,
  registerWorldSnapshot,
} from "./workspaceFixture";
import { constructedWorld } from "../constructedWorldFixture";

export async function refinementFixture() {
  const constructed = constructedWorld(),
    parent = generationSnapshot(constructed.result, constructed.input, crypto.randomUUID());
  supplyRefinementSociety(parent);
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
            [1000, 100],
            [3000, 100],
            [3000, 900],
            [1000, 100],
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
