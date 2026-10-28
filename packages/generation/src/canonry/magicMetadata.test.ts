import { expect, it } from "vitest";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  magicPropagations,
  magicSources,
  magicSystemSchema,
  residentBand,
  type AdaptiveLattice,
  type Band,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { prepareAtlasGeneration } from "../atlasWorkflow";
import { publishGenerationProducts } from "../publication";
import { magicParameterKeys, magicSourceOptions, magicPropagationOptions } from "../magicMetadata";
import { magicProcesses } from "./magicProcesses";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { advectMagic, initializeMagic } from "./magicState";
import { projectMagic } from "./magicFeatures";
import { refineWorkspace } from "./adaptiveWorkspace";
import { magicFieldDefinitions, publishedMagicChannels } from "./magicFieldDefinitions";
import { atlasPublicationDefinitions } from "./atlasPublications";

function fixture() {
  const state = landscape(),
    topology = createAdaptiveTopology([0, 0, 4000, 1000], { maximumSize: 1000, minimumSize: 1000 });
  state.domain.world.id = state.domain.scope.worldId = "00112233-4455-6677-8899-aabbccddeeff";
  state.domain.world.magicSystems = [
    magicSystemSchema.parse({
      id: "river-spirit",
      name: "River spirit",
      source: "placed",
      propagation: "radial",
      phase: "climate",
    }),
  ];
  state.domain.world.epochs = [
    {
      id: "Formation",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 0,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  state.surface = createAdaptiveField("magic-fixture", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: residentBand("int32", (map.mesh as AdaptiveLattice).leafCells()),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 500, featureSamples: 2 },
  };
  initializeMagic(state);
  return state;
}
/** Content cells in id order; content is not a prefix of the ids. */
function contentCells(state: ReturnType<typeof fixture>) {
  const mesh = state.physical!.map.mesh,
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++) if (mesh.membership(i) === 1) cells.push(i);
  return cells;
}
/** Retained activity proportional to cell area, as an extensive quantity. */
function fillRetained(state: ReturnType<typeof fixture>, band: Band, perArea: number) {
  const mesh = state.physical!.map.mesh;
  for (let i = 0; i < mesh.count; i++) band.set(i, mesh.area(i) * perArea);
}
const sum = (band: Band) => Array.from(band).reduce((total, value) => total + value, 0);

it("offers every schema strategy through its executable declaration and preserves existing labels", () => {
  expect(magicSourceOptions.map((option) => option.value)).toEqual([...magicSources]);
  expect(magicPropagationOptions.map((option) => option.value)).toEqual([...magicPropagations]);
  expect(magicSourceOptions.find((option) => option.value === "deep-ocean")!.label).toBe(
    "Deep ocean locus"
  );
  expect(magicPropagationOptions.find((option) => option.value === "ocean-rays")!.label).toBe(
    "Ocean rays, reflections & wakes"
  );
  expect(
    [...magicSourceOptions, ...magicPropagationOptions].every(
      (option) => option.label.trim().length > 0
    )
  ).toBe(true);
});

it("uses source and propagation declarations for both input contracts and applicable parameters", () => {
  const system = fixture().domain.world.magicSystems![0];
  system.origins[0].source = "deep-ocean";
  expect(magicParameterKeys(system)).toEqual(["beamWidth", "featureNoiseScale"]);
  const process = magicProcesses([system]).find(
    (process) => process.contract.id === "canonry.magic-climate"
  )!;
  expect(process.contract.requires).toEqual(
    expect.arrayContaining(["canonry:Ocean", "canonry:Bathymetry"])
  );
  system.origins[0].source = "placed";
  system.origins[0].propagation = "cold-drainage";
  expect(magicParameterKeys(system)).toEqual(
    expect.arrayContaining([
      "logScale",
      "iceRetention",
      "coldRetentionDistance",
      "accumulationArea",
    ])
  );
  expect(magicParameterKeys(system)).not.toContain("beamWidth");
  expect(
    magicProcesses([system]).find((process) => process.contract.id === "canonry.magic-climate")!
      .contract.requires
  ).toContain("canonry:IceState");
});

it("projects and publishes each declared magic channel with its actual quantity and unit", () => {
  const state = fixture(),
    field = state.physical!.magic!.fields[0];
  field.intensity.fill(300);
  fillRetained(state, field.retained, 5);
  field.firstEpoch.fill(2);
  projectMagic(state);
  const prepared = prepareAtlasGeneration(state.domain, {
    areaId: "area",
    seed: 73,
    quality: "draft",
    domains: ["physical", "magic"],
  });
  state.publications = atlasPublicationDefinitions(prepared.input, state.domain.world);
  publishGenerationProducts(state, "magic-metadata");
  for (const channel of publishedMagicChannels) {
    const key = `magic:river-spirit:${channel}`;
    expect(state.surface.units[key]).toBe(magicFieldDefinitions[channel].unit);
    expect(state.surface.quantities![key]).toBe(magicFieldDefinitions[channel].quantity);
    expect(
      state.domain.world.fields.find((field) => field.layerId === "magic")!.channels
    ).toContain(key);
  }
  expect(state.surface.channels["magic:river-spirit:radii"]).toBeUndefined();
});

it("conserves extensive retained activity during real remeshing and preserves discrete markers", () => {
  const state = fixture(),
    field = state.physical!.magic!.fields[0];
  field.history.fill(7);
  field.firstEpoch.fill(2);
  field.radii.fill(500);
  fillRetained(state, field.retained, 5);
  const total = sum(field.retained),
    before = field.retained.length;
  expect(refineWorkspace(state, [{ x: 2000, y: 500, radius: 4000, size: 500 }])).toBe(true);
  expect(field.retained.length).toBeGreaterThan(before);
  expect(sum(field.retained)).toBeCloseTo(total, 6);
  const cells = contentCells(state);
  expect(cells.every((i) => field.history.get(i) === 7)).toBe(true);
  expect(cells.every((i) => field.firstEpoch.get(i) === 2)).toBe(true);
  expect(cells.every((i) => field.radii.get(i) === 500)).toBe(true);
});

it("inherits only carried activity and resets newly formed crust from declared initial values", () => {
  const state = fixture(),
    initial = state.physical!.magic!.fields[0];
  initial.history.fill(7);
  initial.firstEpoch.fill(2);
  initial.stored.fill(9);
  initial.intensity.fill(300);
  projectMagic(state);
  state.physical!.inherited = true;
  initializeMagic(state);
  const inherited = state.physical!.magic!.fields[0],
    [c0, c1] = contentCells(state),
    cells = contentCells(state);
  expect(cells.every((i) => inherited.history.get(i) === 7)).toBe(true);
  expect(cells.every((i) => inherited.stored.get(i) === 9)).toBe(true);
  expect(cells.every((i) => inherited.firstEpoch.get(i) === 2)).toBe(true);
  expect(cells.every((i) => inherited.intensity.get(i) === 0)).toBe(true);
  state.physical!.map.AdvectionSourceIndex.fill(-1);
  state.physical!.map.AdvectionSourceIndex.set(c1, c0);
  advectMagic(state);
  expect(inherited.history.get(c0)).toBe(0);
  expect(inherited.firstEpoch.get(c0)).toBe(-1);
  expect(inherited.history.get(c1)).toBe(7);
  expect(inherited.stored.get(c1)).toBe(9);
  expect(inherited.firstEpoch.get(c1)).toBe(2);
});
