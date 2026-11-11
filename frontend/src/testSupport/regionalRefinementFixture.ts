import { expect, vi } from "vitest";
import {
  regionRefinementInput,
  refinedRegionArea,
  type AtlasFeature,
  type DomainSnapshot,
  spatial,
  createGrid,
  generateBand,
  gridPosition,
  putChannel,
  MapScale,
  canonicalPhysicalFields,
  fieldChannelName,
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
  const scale = width ? width / 4000 : 1;
  supplyRefinementPeople(parent, scale, width ? 15000 : 300);
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
export function suppliedIsland(width: number, height = width / 4, spacing = width / 32) {
  const source = createWorldSnapshot({
      name: "Supplied regional island",
      seed: 73,
      width,
      height,
    }),
    input = { areaId: source.scope.areaId, seed: 73, quality: "draft", domains: ["physical"] },
    surface = createGrid(
      "supplied-island",
      source.scope,
      Math.ceil(width / spacing) + 1,
      Math.ceil(height / spacing) + 1
    );
  surface.scope.resolution = spacing;
  const values: Record<string, [string, (x: number, y: number) => number]> = {
    Elevation: [
      "native-length",
      (x, y) =>
        MapScale.native(
          500 * (1 - ((x - 0.5) / 0.39) ** 2 - ((y - 0.5) / 0.4) ** 2) +
            150 * Math.sin(x * Math.PI * 4)
        ),
    ],
    Temperature: ["native-temperature", () => 460],
    Moisture: ["per-mille", () => 700],
    Rainfall: ["millimetre/year", () => 1200],
    Runoff: ["millimetre/year", () => 700],
    WindX: ["per-mille", () => 800],
    WindY: ["per-mille", () => 200],
    SoilDepth: ["metre", () => 1],
  };
  for (const [name, [unit, value]] of Object.entries(values))
    putChannel(
      surface,
      fieldChannelName(name),
      unit,
      generateBand(
        surface.coverage,
        canonicalPhysicalFields().find((field) => field.name === name)!.type,
        name,
        (i) => {
          const p = gridPosition(surface, i);
          return value(p.x / width, p.y / height);
        }
      )
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
/** A town the parent knows, and an event it recorded there whose reach leaves the region. */
function supplyRefinementPeople(parent: DomainSnapshot, scale: number, townsfolk: number) {
  const root = parent.scope.areaId,
    town = crypto.randomUUID(),
    event = crypto.randomUUID(),
    record = (
      id: string,
      kind: string,
      layerId: string,
      name: string,
      geometry: AtlasFeature["geometry"],
      attributes: Record<string, unknown>
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
      generationDomain: "built",
    });
  parent.world.features[town] = record(
    town,
    "settlement",
    "settlements",
    "Known town",
    { type: "Point", coordinates: [2500 * scale, 300 * scale] },
    {
      population: townsfolk,
      settlementPopulation: townsfolk,
      status: "inhabited",
      founded: "Earlier era",
    }
  );
  parent.world.features[event] = record(
    event,
    "societyEvent",
    "historicalEvents",
    "flood — Earlier era",
    spatial.buffer({ type: "Point", coordinates: [3500, 500] }, 1000)!,
    { eventKind: "flood", era: "Earlier era", casualties: 100, atPlace: town }
  );
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
