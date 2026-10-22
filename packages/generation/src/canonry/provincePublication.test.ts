import { expect, it } from "vitest";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  fieldInterpolator,
  fieldExtrema,
  gridSurfaceSchema,
  rectangle,
  replaceChannel,
  cloneSnapshot,
  createField as createAuthoredField,
  FactDependencies,
  gridType,
  overlayField,
  createGrid,
  putChannel,
  resample,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { publishGenerationProducts } from "../publication";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { prepareProvinceRegions } from "./provinceGeography";
import { preparePhysicalChannels } from "./continuousState";
import { projectNative } from "./atlasProjection";
import { atlasChannels } from "./atlasChannels";
import { refreshWorkspaceSamples } from "./atlasWorkspace";
import { continuousSurface } from "./continuousSurface";
import { provinceTransport } from "./provinceTransport";

function fixture() {
  const state = landscape(),
    bounds: [number, number, number, number] = [0, 0, 1000, 1000];
  state.domain.world.id = state.domain.scope.worldId = "00000000-0000-4000-8000-000000000001";
  state.domain.scope.footprint = rectangle(bounds);
  const topology = createAdaptiveTopology(bounds, { maximumSize: 250, minimumSize: 250 });
  state.surface = createAdaptiveField("province", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  map.provinces = {
    origin: [...map.mesh.origin],
    seed: 1,
    scale: 1000,
    strength: 0,
    sites: [
      { x: -250, y: 0, priority: 0, assembly: 1, motionX: 0.4, motionY: 0.1 },
      { x: 250, y: 0, priority: 0, assembly: 2, motionX: -0.2, motionY: 0.3 },
    ],
  };
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: map.mesh.leafToCell,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  prepareProvinceRegions(map);
  preparePhysicalChannels(map, []);
  refreshWorkspaceSamples(state, state.physical);
  projectNative(state);
  return state;
}
it("delivers the shared province owner and channel bindings through publication and cloning", () => {
  const state = fixture();
  const layer = {
    id: "tectonics",
    name: "Tectonics",
    family: "custom" as const,
    representation: "field" as const,
    color: "#987654",
    profiles: ["world" as const, "region" as const],
    schema: {},
    generator: "test",
  };
  state.publications = [
    { kind: "field", channel: "crustMotionX", unit: "ratio", quantity: "intensive", layer },
  ];
  state.surface.channels = { crustMotionX: state.surface.channels.crustMotionX };
  publishGenerationProducts(state, "run");
  const delivered = gridSurfaceSchema.parse(
    structuredClone(state.domain.numerical[state.domain.world.fields[0].id])
  );
  expect(Object.keys(delivered.geography!.provinces!)).toEqual(["crustMotionX"]);
  expect(delivered.prepared?.adaptive?.crustMotionX).toBeUndefined();
  const at = fieldInterpolator(delivered, "crustMotionX");
  expect(at({ x: 200, y: 500, z: 0 })).toBe(0.4);
  expect(at({ x: 800, y: 500, z: 0 })).toBe(-0.2);
  expect(fieldExtrema(delivered, "crustMotionX", rectangle([100, 100, 900, 900]))).toEqual([
    -0.2, 0.4,
  ]);
  const id = state.domain.world.fields[0].id,
    clone = cloneSnapshot(state.domain);
  replaceChannel(
    clone.numerical[id],
    "crustMotionX",
    "ratio",
    new Float64Array(delivered.active.length).fill(0.8)
  );
  expect(
    fieldInterpolator(state.domain.numerical[id], "crustMotionX")({ x: 200, y: 500, z: 0 })
  ).toBe(0.4);
  expect(fieldInterpolator(clone.numerical[id], "crustMotionX")({ x: 200, y: 500, z: 0 })).toBe(
    0.8
  );
  delivered.geography!.provinces!.crustMotionX.partition.regions![0].province = 99;
  expect(gridSurfaceSchema.safeParse(delivered).success).toBe(false);
  delivered.geography!.provinces!.crustMotionX.partition.regions![0].province = 0;
  delivered.geography!.provinces!.crustMotionX.values = [0.4];
  expect(gridSurfaceSchema.safeParse(delivered).success).toBe(false);
});
it("replaces one province binding without reviving it during unrelated projection", () => {
  const state = fixture(),
    grid = state.surface;
  replaceChannel(grid, "crustMotionX", "ratio", new Float64Array(grid.active.length).fill(0.75));
  const bindings = atlasChannels.filter((b) => b.name === "temperature");
  projectNative(state, false, false, bindings, new Set(["temperature"]));
  expect(fieldInterpolator(grid, "crustMotionX")({ x: 200, y: 500, z: 0 })).toBe(0.75);
  expect(fieldInterpolator(grid, "crustMotionY")({ x: 200, y: 500, z: 0 })).toBe(0.1);
  expect(grid.geography?.provinces?.crustMotionX).toBeUndefined();
});

it("retains each channel's partition when resampling and projecting different owners", () => {
  const first = fixture(),
    second = fixture(),
    map = second.physical!.map;
  map.provinces = {
    ...map.provinces!,
    regions: undefined,
    sites: map.provinces!.sites.map((site) => ({ ...site, x: site.y, y: site.x })),
  };
  prepareProvinceRegions(map);
  projectNative(second);
  const target = createGrid("mixed", first.domain.scope, 3, 3),
    probe = { x: 750, y: 250, z: 0 };
  resample(first.surface, target, "crustMotionX");
  expect(fieldInterpolator(target, "crustMotionX")(probe)).toBe(-0.2);
  resample(second.surface, target, "crustMotionY");
  expect(fieldInterpolator(target, "crustMotionX")(probe)).toBe(-0.2);
  expect(fieldInterpolator(target, "crustMotionY")(probe)).toBe(0.1);
  first.physical!.map.provinces = map.provinces;
  projectNative(
    first,
    false,
    false,
    atlasChannels.filter((binding) => binding.name === "crustMotionY"),
    new Set(["crustMotionY"])
  );
  const delivered = gridType.schema.parse(structuredClone(first.surface));
  expect(fieldInterpolator(delivered, "crustMotionX")(probe)).toBe(-0.2);
  expect(fieldInterpolator(delivered, "crustMotionY")(probe)).toBe(0.1);
});

it.each([false, true])(
  "keeps independent inherited channel owners through transport, projection and clone (genericY=%s)",
  (genericY) => {
    const first = fixture(),
      second = fixture(),
      map = first.physical!.map,
      other = second.physical!.map;
    other.provinces = {
      ...other.provinces!,
      regions: undefined,
      sites: other.provinces!.sites.map((site) => ({ ...site, x: site.y, y: site.x })),
    };
    prepareProvinceRegions(other);
    projectNative(second);
    if (genericY)
      replaceChannel(
        second.surface,
        "crustMotionY",
        "ratio",
        new Float64Array(second.surface.active.length).fill(0.8)
      );
    const patch = createGrid(
      "y-edit",
      { ...second.domain.scope, footprint: rectangle([700, 200, 800, 300]) },
      2,
      2
    );
    putChannel(patch, "crustMotionY", "ratio", new Float64Array(4).fill(0.7));
    overlayField(second.surface, patch, ["crustMotionY"]);
    first.domain.numerical = { x: first.surface, y: second.surface };
    const before = structuredClone(first.domain),
      inputs = cloneSnapshot(first.domain);
    map.inheritedMotion = [
      {
        channel: "crustMotionX",
        source: inputs.numerical.x,
        footprint: first.domain.scope.footprint,
      },
      {
        channel: "crustMotionY",
        source: inputs.numerical.y,
        footprint: first.domain.scope.footprint,
      },
    ];
    preparePhysicalChannels(map, ["CrustMotionX", "CrustMotionY"]);
    const transport = provinceTransport(map, 4);
    expect(transport.displacementAt(750, 250)[0]).toBeCloseTo(-0.8, 8);
    expect(transport.displacementAt(750, 250)[1]).toBeCloseTo(2.8, 8);
    first.surface = continuousSurface(first.surface, first.physical!);
    const assertOwners = () => {
      const delivered = gridSurfaceSchema.parse(structuredClone(first.surface));
      expect(fieldInterpolator(delivered, "crustMotionX")({ x: 750, y: 250, z: 0 })).toBe(-0.2);
      expect(fieldInterpolator(delivered, "crustMotionY")({ x: 750, y: 250, z: 0 })).toBe(0.7);
      expect(fieldInterpolator(delivered, "crustMotionY")({ x: 900, y: 250, z: 0 })).toBe(
        genericY ? 0.8 : 0.1
      );
    };
    assertOwners();
    projectNative(first);
    assertOwners();
    expect(first.domain).toEqual(before);
    expect(inputs).toEqual(before);
  }
);

it.each([false, true])(
  "retains untouched province authority through authored field creation (override=%s)",
  (override) => {
    const state = fixture(),
      parent = "00000000-0000-4000-8000-000000000010";
    const patch = createGrid(
      "patch",
      { ...state.domain.scope, footprint: rectangle([700, 400, 800, 600]) },
      2,
      2
    );
    putChannel(patch, "crustMotionY", "ratio", new Float64Array(4).fill(0.7));
    overlayField(state.surface, patch, ["crustMotionY"]);
    state.domain.numerical[parent] = state.surface;
    const changes = createAuthoredField(
      {
        id: "00000000-0000-4000-8000-000000000011",
        areaId: "area",
        layerId: "physical",
        footprint: state.domain.scope.footprint,
        width: 3,
        height: 3,
        parentFieldId: parent,
        channels: override ? { crustMotionX: { unit: "ratio", values: 0.9 } } : {},
      },
      {
        owner: "creator",
        actor: "creator",
        operationId: "00000000-0000-4000-8000-000000000012",
        scope: state.domain.scope,
        layers: Object.values(state.domain.world.layers),
        fields: [],
        facts: new FactDependencies(),
      },
      state.domain
    );
    const child = gridType.schema.parse(changes.fieldArtifacts![0].grid);
    expect(fieldInterpolator(child, "crustMotionX")({ x: 750, y: 500, z: 0 })).toBe(
      override ? 0.9 : -0.2
    );
    expect(fieldInterpolator(child, "crustMotionY")({ x: 750, y: 500, z: 0 })).toBe(0.7);
    expect(fieldInterpolator(child, "crustMotionY")({ x: 900, y: 500, z: 0 })).toBe(0.3);
    expect(fieldInterpolator(state.surface, "crustMotionX")({ x: 750, y: 500, z: 0 })).toBe(-0.2);
  }
);
