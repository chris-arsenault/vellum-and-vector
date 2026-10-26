import { beforeAll, expect, it } from "vitest";
import { generateAtlas, type AtlasGenerationInput } from "@atlas/generation";
import { population, languageUse, type DomainSnapshot } from "@atlas/domain";
import { newGenerationDraft, prepareDraft } from "./generationDraft";
import { generationSnapshot } from "./generationJobs";
import { presentHumanEras } from "../../packages/generation/src/societyRound";

let result: Awaited<ReturnType<typeof generateAtlas>>;
let published: DomainSnapshot;
let input: AtlasGenerationInput;
let source: DomainSnapshot;
const epochs: { id: string; ice: number; maximum: number; impacts: number }[] = [];
const markerId = "7f6292e2-2b50-42b4-a599-abdbbdceda21";

// The entire end-to-end suite shares this one world. Assertions below are read-only.
beforeAll(async () => {
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
  result = await generateAtlas(source, input, {
    async saveBoundary(boundary) {
      const id = boundary.ancestry[0]?.id;
      if (boundary.kind !== "epoch" || !physical.has(id)) return;
      const map = boundary.state.physical!.map;
      const total = (values: ArrayLike<number>) =>
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
}, 300_000);

it("completes causal physical and human history while retaining authored geography", () => {
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
});

it("publishes finite dimensional terrain, rivers, living cover and retained drainage together", () => {
  const grid = result.state.surface;
  for (const channel of ["elevation", "temperature", "flow", "treeCover", "glacialErosion"])
    expect(grid.channels[channel].every(Number.isFinite), channel).toBe(true);
  expect(grid.channels.flow.some((value) => value > 0)).toBe(true);
  const features = Object.values(published.world.features);
  const rivers = features.filter((feature) => feature.kind === "river");
  expect(rivers.length).toBeGreaterThan(0);
  // Erosion can erase a crater's outline while its excavated material history remains.
  expect(grid.channels.impactExcavation.some((value) => value > 0)).toBe(true);
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
});

it("carries the seven configured systems through physical history into located magic places", () => {
  const grid = result.state.surface;
  expect(source.world.magicSystems).toHaveLength(7);
  for (const system of source.world.magicSystems!)
    expect(grid.channels[`magic:${system.id}:intensity`].every(Number.isFinite), system.id).toBe(
      true
    );
  for (const id of ["fire", "aurora", "pressure"])
    expect(
      grid.channels[`magic:${id}:history`].some((value) => value > 0),
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
});

it("publishes population, politics, names and linguistic distributions from the same world", () => {
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
});
