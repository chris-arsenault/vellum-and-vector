import { afterEach, expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { fileStoreFixture } from "../../../storage-browser/src/fileStoreFixture";
import { blockCacheFixture } from "../../../storage-browser/src/blockCacheFixture";
import { writeFieldChannels, writeFieldLayout } from "../../../storage-browser/src/fieldResources";
import { FieldWorkingSet } from "../../../storage-browser/src/fieldWorkingSet";
import { ZarrResources } from "../../../storage-browser/src/zarrResources";
import { landscape } from "../mapFixtures";
import { atlasChannels } from "../world/atlasChannels";
import { createAtlasWorkspace } from "../world/atlasWorkspace";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { projectNative } from "../world/atlasProjection";
import { createMesh } from "../world/mesh";
import { createField } from "../world/field";
import { groundResourceBindings } from "./groundResources";
import { materialLayer, readLayer, setLayer, type MaterialLayer } from "./rockColumn";
import { rockCatalogue } from "./rockCatalogue";
import { groundFixture } from "./groundStorage";
import { groundSection, projectGround } from "./groundShares";
import { loadOf, seaLoadOf } from "./groundLoad";
import { deposit, erodeFacets } from "./groundLedger";

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((close) => close())
);

const packages = [
  {
    kind: rockCatalogue.basalt.code,
    depth: 10 * 1024,
    strength: 2900,
    formedMin: 1,
    formedMax: 1,
    grainX: 0.8,
  },
  {
    kind: rockCatalogue.shale.code,
    depth: 80 * 1024,
    strength: 600,
    formedMin: 7,
    formedMax: 7,
    grainX: -0.5,
  },
];
function source() {
  const state = landscape(),
    map = createField(createMesh(4, 0)),
    count = state.surface.active.length,
    samples = residentBand(
      "int32",
      Int32Array.from({ length: count }, (_, cell) => cell % 2)
    );
  for (let cell = 0; cell < 2; cell++) {
    const material = packages[cell];
    setLayer(map, cell, 0, material.kind, material.depth, material);
  }
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    grid: state.surface.coverage,
    samples,
    interpolation: {
      samples,
      degree: residentBand("uint8", new Uint8Array(count).fill(2)),
      cells: residentBand(
        "int32",
        Int32Array.from({ length: count * 2 }, (_, cell) => cell % 2)
      ),
      weights: residentBand(
        "float64",
        Float64Array.from({ length: count * 2 }, (_, at) => (at % 2 ? 0.75 : 0.25))
      ),
      stride: 2,
    },
    fixed: [],
    inherited: false,
  };
  return state;
}

it("publishes and imports each supplied material package from one donor across a contact", () => {
  const state = source();
  projectNative(state, false, false, groundResourceBindings, new Set());
  for (let cell = 0; cell < state.surface.active.length; cell++) {
    const material = packages[cell % 2];
    expect(state.surface.channels.rockLayer0.get(cell)).toBe(material.kind);
    expect(state.surface.channels.rockDepth0.get(cell)).toBe(material.depth / 1024);
    expect(state.surface.channels.RockLayerStrength0.get(cell)).toBe(material.strength);
    expect(state.surface.channels.RockLayerFormedMin0.get(cell)).toBe(material.formedMin);
    expect(state.surface.channels.RockLayerGrainX0.get(cell)).toBe(material.grainX);
  }
  // A small child resource import samples between those published cells; no process is run.
  const area = state.domain.world.areas.area;
  state.domain.world.areas.parent = { ...area, id: "parent" };
  area.parentId = "parent";
  area.profile = "region";
  const inherited = createAtlasWorkspace(state, "draft");
  for (let cell = 0; cell < inherited.map.mesh.count; cell++) {
    const layer = readLayer(inherited.map, cell, 0),
      donor = packages.find((material) => material.kind === layer.kind);
    expect(donor).toBeDefined();
    expect(layer).toMatchObject(donor!);
  }
});

const buried = materialLayer(rockCatalogue.sandstone.code, 30 * 1024, {
  strength: 1350,
  damage: 0.4,
  grainX: -0.3,
  grainY: 0.7,
  formedMin: 2,
  formedMax: 4,
  altered: 8,
});
const cutCap = materialLayer(rockCatalogue.limestone.code, 5 * 1024, {
  strength: 1700,
  formedMin: 6,
  formedMax: 6,
  altered: 9,
});
const basement = materialLayer(rockCatalogue.granite.code, 1, {
  strength: 2800,
  formedMin: -1,
  formedMax: -1,
  altered: 3,
});
const cover = [
  materialLayer(rockCatalogue.alluvium.code, 2 * 1024, { formedMin: 10, formedMax: 10 }),
  materialLayer(rockCatalogue.shale.code, 3 * 1024, {
    strength: 450,
    damage: 0.8,
    formedMin: 7,
    formedMax: 7,
  }),
];
const cutCover = [
  materialLayer(rockCatalogue.basalt.code, 1024, {
    strength: 500,
    damage: 0.9,
    formedMin: 12,
    formedMax: 12,
  }),
  materialLayer(rockCatalogue.limestone.code, 2 * 1024, {
    strength: 300,
    formedMin: 5,
    formedMax: 5,
  }),
];
const cargo = materialLayer(rockCatalogue.granite.code, 0, {
  secondaryKind: rockCatalogue.shale.code,
  secondaryShare: 0.25,
  mixed: 1,
  strength: 700,
  damage: 0.6,
  grainX: 0.2,
  grainY: -0.4,
  formedMin: 1,
  formedMax: 11,
  altered: 13,
});

function layeredSource() {
  const state = source(),
    work = state.physical!,
    map = groundFixture(work.map),
    donors = Array.from({ length: map.mesh.count }, (_, cell) => cell)
      .filter((cell) => map.mesh.membership(cell) === 1)
      .slice(0, 2);
  map.BaseSeaLevel = 9 * 1024;
  work.map = map;
  for (const band of [work.samples, work.interpolation!.cells])
    for (let at = 0; at < band.length; at++) band.set(at, donors[band.get(at)]);
  for (const [index, cell] of donors.entries()) {
    for (const [column, layers] of [
      [
        "land",
        [
          materialLayer(packages[index].kind, packages[index].depth, packages[index]),
          buried,
          basement,
        ],
      ],
      ["cut", [cutCap, buried, basement]],
      ["loose", cover],
      ["cutLoose", cutCover],
    ] as const)
      layers.forEach((layer, slot) =>
        setLayer(map, cell, slot, layer.kind, layer.depth, layer, column)
      );
    map.BedrockElevation.set(cell, 100 * 1024);
    map.CrustSupportElevation.set(cell, 135 * 1024);
    map.SurfaceRockLoad.set(cell, -12 * 1024);
    map.GroundCutShare.set(cell, 0.25);
    map.GroundCutDepth.set(cell, 40 * 1024);
    loadOf(map).add(cell, { ...cargo, depth: map.mesh.area(cell) * 2 });
    seaLoadOf(map).add(cell, { ...cargo, depth: map.mesh.area(cell) * 0.5 });
    projectGround(map, cell);
  }
  projectNative(state, false, false, atlasChannels, new Set(["seaDatum"]));
  return state;
}

async function reopenGround() {
  const state = layeredSource(),
    files = fileStoreFixture(),
    blocks = blockCacheFixture(),
    resources = new ZarrResources(files.store, 262_144);
  cleanups.push(
    () => files.close(),
    () => blocks.close()
  );
  const layout = await writeFieldLayout(resources, state.surface, "ground-layout", 1e-6),
    resource = await writeFieldChannels(resources, state.surface, "ground-channels", layout),
    names = Object.keys(state.surface.channels);
  // New resource reader: reconstruction cannot reach the supplied mutable source field.
  const working = new FieldWorkingSet(new ZarrResources(files.store, 262_144), blocks.cache);
  cleanups.push(() => working.close());
  const loaded = await working.load(resource.id, names, layout.geography),
    inherited = landscape(),
    parent = inherited.domain.world.areas.area;
  inherited.domain.world.areas.child = {
    ...parent,
    id: "child",
    parentId: "area",
    profile: "region",
  };
  inherited.domain.world.fields.push({
    id: loaded.id,
    areaId: "area",
    layerId: "physical",
    algorithm: "supplied-ground",
    state: "generated",
    samples: loaded.active.length,
    channels: names,
    source: { kind: "operation", id: "supplied-publication" },
  });
  inherited.domain.numerical[loaded.id] = loaded;
  inherited.surface.scope.areaId = "child";
  inherited.surface.channels.seaDatum = loaded.channels.seaDatum;
  // Material comes through the captured parent field, not fallback channels on the child surface.
  return { loaded, map: createAtlasWorkspace(inherited, "draft").map };
}

it("reopens serialized strata, facets, loose cover and placement before exposing a buried contact", async () => {
  const { loaded, map } = await reopenGround(),
    cell = Array.from({ length: map.mesh.count }, (_, i) => i).find(
      (i) => map.mesh.membership(i) === 1
    )!,
    land = readLayer(map, cell, 0),
    donor = packages.find((bed) => bed.kind === land.kind)!;
  expect(land).toMatchObject(donor);
  expect(readLayer(map, cell, 1)).toMatchObject(buried);
  expect(readLayer(map, cell, 2)).toMatchObject(basement);
  expect(readLayer(map, cell, 0, "cut")).toMatchObject(cutCap);
  expect(readLayer(map, cell, 1, "cut")).toMatchObject(buried);
  cover.forEach((bed, slot) => expect(readLayer(map, cell, slot, "loose")).toMatchObject(bed));
  cutCover.forEach((bed, slot) =>
    expect(readLayer(map, cell, slot, "cutLoose")).toMatchObject(bed)
  );
  expect(map.BaseSeaLevel).toBe(9 * 1024);
  expect(map.BedrockElevation.get(cell)).toBeCloseTo(100 * 1024);
  expect(map.CrustSupportElevation.get(cell)).toBeCloseTo(135 * 1024);
  expect(map.SurfaceRockLoad.get(cell)).toBeCloseTo(-12 * 1024);
  expect(map.GroundCutShare.get(cell)).toBe(0.25);
  expect(map.GroundCutDepth.get(cell)).toBe(40 * 1024);
  expect(groundSection(map, cell, "land")[2].top).toBeCloseTo(110 * 1024);
  expect(groundSection(map, cell, "cut")[2].top).toBeCloseTo(70 * 1024);
  const removed: MaterialLayer[] = [];
  erodeFacets(map, cell, [0, 10 * 1024], "abrasion", "load", (parcel) => removed.push(parcel));
  expect(removed.map(({ kind }) => kind)).toEqual([
    rockCatalogue.basalt.code,
    rockCatalogue.limestone.code,
    cutCap.kind,
    buried.kind,
  ]);
  expect(removed[0]).toMatchObject({ formedMin: 12, strength: 500, damage: 0.9 });
  expect(removed[3]).toMatchObject({ formedMin: 2, formedMax: 4, altered: 8, grainY: 0.7 });
  expect(readLayer(map, cell, 0, "cut")).toMatchObject({ ...buried, depth: 28 * 1024 });
  expect(groundSection(map, cell, "cut")[0].medium).toBe("rock");
  expect(readLayer(map, cell, 0)).toMatchObject(donor);
  expect(loaded.channels.RockCutLayerKind0.get(0)).toBe(cutCap.kind);
});

it("reopens mixed cargo by area and lands its retained provenance without changing captured resources", async () => {
  const { loaded, map } = await reopenGround(),
    cell = Array.from({ length: map.mesh.count }, (_, i) => i).find(
      (i) => map.mesh.membership(i) === 1
    )!,
    load = loadOf(map),
    held = load.get(cell);
  expect(held).toMatchObject({ ...cargo, depth: map.mesh.area(cell) * 2 });
  expect(seaLoadOf(map).get(cell)).toMatchObject({ ...cargo, depth: map.mesh.area(cell) * 0.5 });
  const parcel = load.take(cell, map.mesh.area(cell)),
    depth = (parcel.depth / map.mesh.area(cell)) * 1024;
  deposit(map, cell, depth, "settling", "load", parcel);
  expect(readLayer(map, cell, 0, "loose")).toMatchObject({
    ...cargo,
    depth: 1024,
    bedSlopeX: 0,
    bedSlopeY: 0,
    deposited: map.CompletedEpochCount,
    consolidation: 0,
  });
  expect(readLayer(map, cell, 1, "loose")).toMatchObject(cover[0]);
  expect(loaded.channels.GroundLoadVolume.get(0)).toBe(2);
  expect(loaded.channels.GroundLoadSecondaryKind.get(0)).toBe(rockCatalogue.shale.code);
  expect(() => loaded.channels.GroundLoadVolume.set(0, 999)).toThrow(/Immutable/);
});
