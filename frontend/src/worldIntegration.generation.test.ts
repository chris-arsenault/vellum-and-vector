import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAtlas, refineRegionalMap, type AtlasGenerationInput } from "@atlas/generation";
import {
  landmarkKind,
  landmarkLayer,
  everySample,
  languageUse,
  population,
  someSample,
  spatial,
  rectangle,
  type DomainSnapshot,
} from "@atlas/domain";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { generationSnapshot } from "./generationJobs";
import { presentHumanEras } from "../../packages/generation/src/societyRound";
import { generationStorageFixture } from "../../packages/storage-browser/src/generationFixture";
import {
  refinementFixture,
  denyParentReads,
  numericalReads,
} from "./testSupport/regionalRefinementFixture";
import { generationSource } from "./workspaceGeneration";
import { WorkspaceFields } from "./workspaceFields";
import { loadGenerationFeatures } from "./generationInputs";
import { SqliteFeatureWorkspace, SqliteNetworkWorkspace } from "@atlas/storage-browser";
import { sqliteFixture } from "../../packages/storage-browser/src/sqliteFixture";
import { publishWorkspaceGeneration } from "./generationPublication";
import {
  regionalWorkload,
  siblingRegion,
  assertRegionalPublication,
  assertWorkloadDetail,
  type RegionalWorkloadOutput,
} from "./testSupport/regionalWorkload";
import { regionalOverview } from "./testSupport/regionalOverview";
import { normalizedRegionFixture } from "./testSupport/normalizedRegionFixture";

it("selects and completes a typical Standard region from a supplied default-sized world", async () => {
  const f = await normalizedRegionFixture(),
    before = f.workspace.catalog.exportFeatures(f.id, f.root, null, 128),
    run = await regionalWorkload(f);
  try {
    const result = await refineRegionalMap(run.source, run.input, run.options),
      published = await run.publish(result);
    expect(published.samples).toBeGreaterThan(40_000);
    expect(published.samples).toBeLessThan(140_000);
    expect(published.counts.river).toBeGreaterThan(1);
    expect(published.rasterResult.sampled).toBeGreaterThan(0);
    expect(published.rasterResult.categories.length).toBeGreaterThan(1);
    expect(result.state.history).toEqual([]);
    expect(f.workspace.catalog.exportFeatures(f.id, f.root, null, 128)).toEqual(before);
    console.info("normalized Standard region", {
      creationMs: f.creationMs,
      samples: published.samples,
      generationMs: published.generationMs,
      phases: published.phases,
      firstRasterMs: published.rasterResult.milliseconds,
    });
  } finally {
    await run.close();
  }
}, 300_000);
it("develops regional detail without sibling or repeated-refinement work propagation", async () => {
  const f = await refinementFixture(480000),
    catalog = f.workspace.catalog,
    parentFeatures = catalog.exportFeatures(f.id, f.root, null, 128),
    rootScope = { worldId: f.id, areaId: f.root, spaceId: f.parent.scope.spaceId },
    rootFieldIds = f.parent.world.fields.map((r) => r.id),
    rootFields = await catalog.readRecords(rootScope, "field", rootFieldIds);
  const outputs: RegionalWorkloadOutput[] = [];
  let sibling = "";
  for (const step of ["first", "second", "repeat", "small"]) {
    if (step === "second")
      sibling = await siblingRegion(
        f,
        "Independent western region",
        rectangle([40000, 20000, 100000, 100000])
      );
    const child =
        step === "first"
          ? f.child
          : step === "small"
            ? await siblingRegion(
                f,
                "Smaller draft coast",
                rectangle([140000, 80000, 200000, 110000])
              )
            : sibling,
      previousFirst = catalog.exportFeatures(f.id, f.child, null, 128),
      run = await regionalWorkload(f, child, step === "small" ? "draft" : "standard");
    try {
      const result = await refineRegionalMap(run.source, run.input, run.options),
        published = await run.publish(result);
      if (step === "first") await regionalOverview(result, [...run.features.values()]);
      assertWorkloadDetail(result, published);
      expect(result.state.domain.world.epochs).toEqual(f.parent.world.epochs);
      if (step === "first")
        expect(
          [...run.features.values()].some((feature) => feature.name === "Known inland core")
        ).toBe(true);
      if (step === "repeat") {
        expect(published.signature).toEqual(outputs[1].signature);
        expect(published.samples).toBe(outputs[1].samples);
      }
      if (step !== "first") {
        expect(catalog.exportFeatures(f.id, f.child, null, 128)).toEqual(previousFirst);
      }
      outputs.push(published);
      console.info("regional workload", {
        step,
        quality: run.input.quality,
        samples: published.samples,
        fields: published.fields,
        generationMs: published.generationMs,
        phases: published.phases,
        firstRaster: published.rasterResult.milliseconds,
        peakBytes: published.peakBytes,
        features: published.counts,
      });
    } finally {
      await run.close();
    }
  }
  expect(catalog.exportFeatures(f.id, f.root, null, 128)).toEqual(parentFeatures);
  expect(await catalog.readRecords(rootScope, "field", rootFieldIds)).toEqual(rootFields);
}, 300000);
it("completes physical and society refinement and publishes local geometry outside the outline with parent reads denied", async () => {
  const fixture = await refinementFixture(),
    { id, root, child, workspace, parent } = fixture,
    before = workspace.catalog.exportFeatures(id, root, null, 128),
    parentFields = new Set(parent.world.fields.map((field) => field.id)),
    rootScope = { worldId: id, areaId: root, spaceId: parent.scope.spaceId },
    rootFields = await workspace.catalog.readRecords(rootScope, "field", [...parentFields]),
    deny = denyParentReads(workspace, child, parentFields),
    db = await sqliteFixture(),
    features = new SqliteFeatureWorkspace(db),
    sourceFeatures = new SqliteFeatureWorkspace(db, "source_features"),
    networks = new SqliteNetworkWorkspace(db),
    sourceNetworks = new SqliteNetworkWorkspace(db, "source_networks"),
    fields = new WorkspaceFields(workspace.catalog, workspace.resources, workspace.working.cache);
  try {
    const source = await generationSource(workspace.catalog, id, child);
    await loadGenerationFeatures(
      source,
      workspace.catalog,
      sourceFeatures,
      undefined,
      sourceNetworks
    );
    await fields.read(source, numericalReads(source));
    const input = {
      areaId: child,
      quality: "draft",
      seed: 73,
      domains: ["physical", "magic", "cultural", "political", "built"],
    };
    const result = await refineRegionalMap(source, input, {
      cache: workspace.working.cache,
      features,
      sourceFeatures,
      networks,
      sourceNetworks,
    });
    const operationId = crypto.randomUUID(),
      output = generationSnapshot(result, input, operationId, source);
    await publishWorkspaceGeneration(
      workspace.catalog,
      workspace.resources,
      source,
      output,
      operationId,
      false,
      [],
      () => {},
      undefined,
      { features, sourceFeatures, networks, sourceNetworks }
    );
    expect(workspace.catalog.exportFeatures(id, root, null, 128)).toEqual(before);
    expect(await workspace.catalog.readRecords(rootScope, "field", [...parentFields])).toEqual(
      rootFields
    );
    await assertRegionalPublication(fixture, result, output, source, features);
  } finally {
    deny.mockRestore();
    await fields.close();
    db.close();
  }
}, 300_000);

let result: Awaited<ReturnType<typeof generateAtlas>>;
let published: DomainSnapshot;
let input: AtlasGenerationInput;
let source: DomainSnapshot;
let storage: Awaited<ReturnType<typeof generationStorageFixture>>;
const epochs: { id: string; ice: number; maximum: number; impacts: number }[] = [];
const markerId = "7f6292e2-2b50-42b4-a599-abdbbdceda21";

// World assertions share one generation; the regional case supplies its parent directly.
async function initializeSharedWorld() {
  storage = await generationStorageFixture();
  const draft = newGenerationDraft();
  draft.width = 2_000_000;
  draft.height = 1_000_000;
  draft.recipe.quality = "draft";
  draft.recipe.domains = ["physical", "magic", "cultural", "political", "built"];
  const prepared = prepareDraft(draft);
  expect(prepared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  source = prepared.source;
  input = prepared.input;
  expect(input.quality).toBe("draft");
  source.world.features[markerId] = {
    id: markerId,
    name: "Authored marker",
    areaId: input.areaId,
    layerId: "pois",
    kind: "poi",
    geometry: { type: "Point", coordinates: [50_000, 50_000] },
    attributes: {},
    relations: [],
    causes: [],
    detail: {},
    actor: "creator",
    state: "authored",
    protected: true,
    generationId: null,
  };
  const physical = new Set(source.world.epochs.map((epoch) => epoch.id));
  storage.source(source);
  result = await generateAtlas(source, input, {
    ...storage.options,
    async saveBoundary(boundary) {
      const id = boundary.ancestry[0]?.id;
      if (boundary.kind !== "epoch" || !physical.has(id)) return;
      const map = boundary.state.physical!.map;
      const total = (values: Iterable<number>) =>
        Array.from(values).reduce((sum, value) => sum + value, 0);
      epochs.push({
        id,
        ice: total(map.IceThickness),
        maximum: total(map.MaximumIceThickness),
        impacts: total(map.ImpactExcavation),
      });
    },
  });
  published = generationSnapshot(result, input, "shared-draft-world", source);
  // Assertions inspect this small result; production publication pages these records directly.
  published.world.features = Object.fromEntries(
    [...storage.options.features.values()].map((feature) => [feature.id, feature])
  );
}

function assertWorldHistory() {
  expect(result.state.diagnostics?.filter((item) => item.severity === "error") ?? []).toEqual([]);
  expect(result.state.physical).toBeUndefined();
  expect(epochs.map((epoch) => epoch.id)).toEqual(source.world.epochs.map((epoch) => epoch.id));
  expect(result.state.history).toHaveLength(
    source.world.epochs.length + presentHumanEras(input.settings!).length
  );
  expect(published.world.features[markerId]).toEqual(source.world.features[markerId]);
  expect(published.world.generations.at(-1)?.configuration).toEqual(input.configuration);
  expect(epochs.some((epoch) => epoch.ice > 0)).toBe(true);
  expect(epochs.at(-1)!.maximum).toBeGreaterThanOrEqual(epochs.at(-1)!.ice);
  expect(epochs[0].impacts).toBeGreaterThan(0);
}

function assertWorldGeography() {
  const grid = result.state.surface;
  for (const channel of ["elevation", "temperature", "flow", "treeCover", "glacialErosion"])
    expect(everySample(grid.channels[channel], Number.isFinite), channel).toBe(true);
  expect(someSample(grid.channels.flow, (value) => value > 0)).toBe(true);
  const features = Object.values(published.world.features);
  const rivers = features.filter((feature) => feature.kind === "river");
  expect(rivers.length).toBeGreaterThan(0);
  // Erosion can erase a crater's outline while its excavated material history remains.
  expect(someSample(grid.channels.impactExcavation, (value) => value > 0)).toBe(true);
  for (const river of rivers) {
    expect(river.geometry.type).toBe("LineString");
    if (river.geometry.type !== "LineString") continue;
    for (const key of ["widths", "depths", "discharges", "catchmentAreas"]) {
      const values = river.attributes[key] as number[];
      expect(values).toHaveLength(river.geometry.coordinates.length);
      expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    }
  }
  const reaches = published.world.drainage![input.areaId].reaches;
  expect(new Set(reaches.flatMap((reach) => reach.featureIds))).toEqual(
    new Set(rivers.map((river) => river.id))
  );
  for (const reach of reaches) {
    expect(reach.discharges).toHaveLength(reach.coordinates.length);
    if (reach.downstream !== null) expect(reaches[reach.downstream]).toBeDefined();
  }
}

function assertWorldMagic() {
  const grid = result.state.surface;
  expect(source.world.magicSystems).toHaveLength(7);
  for (const system of source.world.magicSystems!)
    expect(
      everySample(grid.channels[`magic:${system.id}:intensity`], Number.isFinite),
      system.id
    ).toBe(true);
  for (const id of ["fire", "aurora", "pressure"])
    expect(
      someSample(grid.channels[`magic:${id}:history`], (value) => value > 0),
      id
    ).toBe(true);
  const sites = Object.values(published.world.features).filter(
    (feature) => feature.layerId === "magic" && feature.footprint
  );
  expect(sites.length).toBeGreaterThan(0);
  expect(sites.some((feature) => feature.geometry.type === "Point")).toBe(true);
  expect(
    published.world.fields.some((field) =>
      field.channels?.includes("magic:pressure:coastalHistory")
    )
  ).toBe(true);
}

function assertWorldSociety() {
  const society = published.world.societies![input.areaId];
  expect(society.communities.length).toBeGreaterThan(1);
  expect(
    society.communities.reduce((sum, community) => sum + population(community), 0)
  ).toBeGreaterThan(0);
  expect(society.history).toHaveLength(input.settings!.humanEras.length);
  for (const record of society.history)
    expect(record.before + record.births - record.deaths).toBeCloseTo(record.after, 4);
  for (const community of society.communities) {
    expect(community.name).not.toMatch(/\d|Name-|markov:|slot:/);
    if (population(community) > 0)
      expect(
        Object.values(languageUse(community.groups)).reduce((sum, share) => sum + share, 0)
      ).toBeCloseTo(1, 8);
  }
  const features = Object.values(published.world.features);
  expect(features.some((feature) => feature.kind === "settlement")).toBe(true);
  expect(features.some((feature) => feature.kind === "sovereignty")).toBe(true);
  expect(features.every((feature) => feature.name.trim().length > 0)).toBe(true);
  expect(
    published.world.fields.some((field) =>
      field.channels?.some((channel) => channel.startsWith("languageUse:"))
    )
  ).toBe(true);
}

function assertWorldLandmarks() {
  const records = published.world.landmarks,
    parameters = input.resolvedFeatures!.parameters,
    magic = (record: { kind: string }) => Boolean(landmarkKind(record.kind)?.system),
    [w, s, e, n] = spatial.bounds(source.world.reference.domain);
  expect(parameters.landscapeLandmarks).toBeGreaterThan(0);
  expect(parameters.magicLandmarks).toBeGreaterThan(0);
  expect(records.filter((record) => !magic(record))).toHaveLength(parameters.landscapeLandmarks);
  expect(records.filter(magic)).toHaveLength(parameters.magicLandmarks);
  expect(new Set(records.map((record) => record.kind)).size).toBeGreaterThanOrEqual(
    Math.min(3, parameters.landscapeLandmarks) + Math.min(2, parameters.magicLandmarks)
  );
  for (const record of records) {
    const kind = landmarkKind(record.kind)!;
    expect(record.origin).toBe("generated");
    expect(record.name).not.toMatch(/^$|\d|Name-|markov:|slot:/);
    expect(record.emplacedAtEpoch).toBeLessThan(source.world.epochs.length);
    const [x0, y0, x1, y1] = spatial.bounds(record.geometry);
    expect(x0 >= w && x1 <= e && y0 >= s && y1 <= n, `${record.kind} inside the world`).toBe(true);
    const feature = published.world.features[record.id];
    expect(feature, `${record.kind} published under its record id`).toBeDefined();
    expect(feature).toMatchObject({
      kind: "landmark",
      layerId: landmarkLayer(kind),
      name: record.name,
      attributes: { landmarkKind: record.kind, origin: "generated" },
    });
    expect(["realized", "latent"]).toContain(feature.attributes.signature);
    expect(Number(feature.attributes.maintenance)).toBeGreaterThanOrEqual(0);
    if (kind.system) {
      // The injected source is a record of the world, owned by the landmark.
      const sourceRecord = published.world.magic.find((entry) => entry.landmarkId === record.id);
      expect(sourceRecord, `${record.kind} source record`).toMatchObject({
        systemId: kind.system,
      });
      expect(feature.attributes).toMatchObject({ system: kind.system });
      expect(Number(feature.attributes.sourceStrength)).toBeGreaterThan(0);
    }
    if (feature.attributes.signature !== "realized") continue;
    const capped = String(feature.attributes.notes).includes("caps the source");
    for (const [key, value] of Object.entries(feature.attributes)) {
      if (!key.endsWith("Target")) continue;
      const measured = feature.attributes[key.slice(0, -"Target".length)];
      expect(typeof measured, `${record.kind} ${key} measured ${String(measured)}`).toBe("number");
      if (!capped)
        expect(measured, `${record.kind} ${key}`).toBeGreaterThanOrEqual(Number(value) - 0.5);
    }
  }
}

describe("shared initial world", () => {
  beforeAll(initializeSharedWorld, 300_000);
  afterAll(() => storage?.close());
  it("retains authored geography through physical and human history", assertWorldHistory);
  it("publishes finite terrain, rivers, cover and retained drainage", assertWorldGeography);
  it("locates seven magic systems and their physical history", assertWorldMagic);
  it("publishes society, politics, names and language distributions", assertWorldSociety);
  it("sites, measures and names landscape and magic landmarks", assertWorldLandmarks);
});
