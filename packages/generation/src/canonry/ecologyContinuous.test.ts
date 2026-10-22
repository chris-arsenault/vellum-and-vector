import { expect, it } from "vitest";
import {
  createGrid,
  fieldInterpolator,
  spatial,
  biomeCode,
  gridPosition,
  rectangle,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { refreshWorkspaceSamples } from "./atlasWorkspace";
import { projectNative } from "./atlasProjection";
import { classifyBiome } from "./ecologyEnvironment";
import { extractEcologicalFeatures } from "./ecologyFeatures";

function ecologicalFixture(
  trees: (x: number, y: number) => number,
  configure: (map: ReturnType<typeof createField>) => void = () => {},
  geography: (state: ReturnType<typeof landscape>) => void = () => {}
) {
  const state = landscape();
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.surface = createGrid("smooth-life", state.domain.scope, 9, 3);
  const map = createField(createWorldMesh(state.surface.bounds, 256, 1000));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(0),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 1000, minimumSize: 1000, featureSamples: 2 },
  };
  map.Elevation.fill(100 * 1024);
  map.Temperature.fill(450);
  map.Rainfall.fill(1200);
  map.Slope.fill(0.02);
  map.GrassCover.fill(0.2);
  for (let i = 0; i < map.mesh.count; i++) {
    const p = { x: map.mesh.x[i] + map.mesh.origin[0], y: map.mesh.y[i] + map.mesh.origin[1] };
    map.TreeCover[i] = map.BroadleafCover[i] = trees(p.x, p.y);
  }
  configure(map);
  for (let i = 0; i < map.mesh.count; i++) map.BiomeCodes[i] = classifyBiome(map, i);
  refreshWorkspaceSamples(state, state.physical);
  projectNative(state);
  geography(state);
  extractEcologicalFeatures(state);
  return state;
}

it("derives selectable woodland and category reads from cover between samples", () => {
  const state = ecologicalFixture(
    (x, y) => 0.8 * Math.exp(-(((x - 2000) / 900) ** 2 + ((y - 500) / 400) ** 2))
  );
  const read = fieldInterpolator(state.surface, "biome"),
    trees = fieldInterpolator(state.surface, "treeCover");
  const forest = Object.values(state.domain.world.features).filter(
    (f) => f.attributes.biome === "Temperate forest"
  );
  expect(forest.length).toBeGreaterThan(0);
  const forestCoverage = forest.map((f) => spatial.pointCoverage(f.geometry));
  let woodland = 0;
  for (let y = 31; y < 1000; y += 71)
    for (let x = 51; x < 4000; x += 83) {
      const p = { x, y, z: 0 },
        cover = trees(p);
      if (Math.abs(cover - 0.4) < 0.03) continue;
      const expected = cover >= 0.4;
      expect(read(p) === biomeCode("Temperate forest")).toBe(expected);
      expect(forestCoverage.some((covers) => covers(p))).toBe(expected);
      if (cover >= 0.15 && cover < 0.4) woodland++;
    }
  expect(woodland).toBeGreaterThan(0);
  for (let i = 0; i < state.surface.active.length; i++)
    expect(Number.isInteger(read(gridPosition(state.surface, i)))).toBe(true);
});

it("keeps a temperate band between separate temperature and conifer thresholds", () => {
  const state = ecologicalFixture(
    () => 0.8,
    (map) => {
      for (let i = 0; i < map.mesh.count; i++) {
        const x = map.mesh.x[i] + map.mesh.origin[0],
          d = (x - 2070) / 100000;
        map.Temperature[i] = 10 * (38 + (x - 2030) / 100);
        map.BroadleafCover[i] = 0.4 - d / 2;
        map.ConiferCover[i] = 0.4 + d / 2;
      }
    }
  );
  const p = { x: 2050, y: 500, z: 0 };
  expect(fieldInterpolator(state.surface, "biome")(p)).toBe(biomeCode("Temperate forest"));
  expect(
    Object.values(state.domain.world.features)
      .filter((f) => f.attributes.biome === "Temperate forest")
      .some((f) => spatial.covers(f.geometry, { type: "Point", coordinates: [p.x, p.y] }))
  ).toBe(true);
});

it.each([
  [101, false],
  [110, false],
  [101, true],
  [110, true],
] as const)(
  "uses an authoritative narrow lake polygon and its own stage %s over ocean %s",
  (level, ocean) => {
    const state = ecologicalFixture(
      () => 0.8,
      undefined,
      (state) => {
        const source = state.surface.reconstruction!;
        if (ocean) state.surface.ocean = rectangle([0, 0, 4000, 1000]);
        source.water = {
          elevation: source.channels.elevation,
          bodyIds: new Float64Array(source.support.x.length).fill(2),
          seaLevel: 0,
          lakes: [
            {
              id: 2,
              footprint: {
                type: "Polygon",
                coordinates: [
                  [
                    [2030, 300],
                    [2070, 300],
                    [2070, 700],
                    [2030, 700],
                    [2030, 300],
                  ],
                ],
              },
              level,
            },
          ],
        };
      }
    );
    const p = { x: 2050, y: 500, z: 0 },
      code = fieldInterpolator(state.surface, "biome")(p),
      forest = Object.values(state.domain.world.features).filter(
        (f) => f.attributes.biome === "Temperate forest"
      );
    expect(code).toBe(biomeCode(level === 110 ? "Freshwater" : "Temperate forest"));
    expect(
      forest.some((f) => spatial.covers(f.geometry, { type: "Point", coordinates: [p.x, p.y] }))
    ).toBe(level === 101);
  }
);

it.each([0.5, 1])(
  "retains intermediate woodland and separate forest identities for cover step %s",
  (cover) => {
    const state = ecologicalFixture((x) => (x < 2000 ? 0 : cover)),
      read = fieldInterpolator(state.surface, "biome"),
      trees = fieldInterpolator(state.surface, "treeCover"),
      features = Object.values(state.domain.world.features);
    const woodland = features.filter((f) => f.attributes.biome === "Woodland"),
      forest = features.filter((f) => f.attributes.biome === "Temperate forest");
    expect(woodland.length).toBeGreaterThan(0);
    expect(forest.length).toBeGreaterThan(0);
    // Reuse indexed predicates instead of reparsing each polygon at every probe.
    const regions = [
      [biomeCode("Woodland"), woodland.map((f) => spatial.pointCoverage(f.geometry))],
      [biomeCode("Temperate forest"), forest.map((f) => spatial.pointCoverage(f.geometry))],
    ] as const;
    for (let y = 21; y < 1000; y += 67)
      for (let x = 21; x < 4000; x += 21) {
        const p = { x, y, z: 0 },
          treeCover = trees(p);
        if (Math.min(Math.abs(treeCover - 0.15), Math.abs(treeCover - 0.4)) < 0.02) continue;
        for (const [code, coverage] of regions)
          expect(
            coverage.some((covers) => covers(p)),
            `${code} at ${x},${y}`
          ).toBe(read(p) === code);
      }
    const ids = Object.keys(state.domain.world.features).sort();
    extractEcologicalFeatures(state);
    expect(Object.keys(state.domain.world.features).sort()).toEqual(ids);
  }
);
