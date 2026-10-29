import { expect, it } from "vitest";
import { putChannel, point, spatial, surfaceCode } from "@atlas/domain";
import { worldGeographyFixture } from "../../packages/generation/src/canonry/worldGeographyFixtures";
import { classifyBiome } from "../../packages/generation/src/canonry/ecologyEnvironment";
import { classifyNaturalSurface } from "../../packages/generation/src/canonry/naturalSurface";
import { initializeMagic } from "../../packages/generation/src/canonry/magicState";
import { extractEcologicalFeatures } from "../../packages/generation/src/canonry/ecologyFeatures";
import { projectedValues } from "../../packages/generation/src/canonry/atlasSampling";
import { numericTileSampler, terrainSampleBands } from "./numericTiles";

it("keeps a declared forest at the actual natural-surface tile edge as physical cover moves", () => {
  const state = worldGeographyFixture(),
    work = state.physical!,
    map = work.map;
  initializeMagic(state, false);
  for (const boundary of [300_000, 337_500]) {
    state.domain.world.features = {};
    for (let i = 0; i < map.mesh.count; i++) {
      const forest = map.mesh.x(i) + map.mesh.origin[0] >= boundary;
      map.TreeCover.set(i, forest ? 0.8 : 0.1);
      map.BroadleafCover.set(i, map.TreeCover.get(i));
      map.GrassCover.set(i, forest ? 0 : 0.7);
      map.BiomeCodes.set(i, classifyBiome(map, i));
    }
    classifyNaturalSurface(state);
    putChannel(state.surface, "elevation", "metre", projectedValues(work, map.Elevation));
    putChannel(
      state.surface,
      "naturalSurface",
      "category",
      projectedValues(work, work.magic!.naturalSurface, true)
    );
    putChannel(
      state.surface,
      "finalSurface",
      "category",
      projectedValues(work, work.magic!.finalSurface, true)
    );
    const sample = numericTileSampler({
      id: "base",
      areaId: "area",
      channel: "elevation",
      field: state.surface,
      surface: state.surface,
      footprint: state.domain.scope.footprint,
      bounds: state.surface.bounds,
    });
    const before = sample([250_000, 150_000, 400_000, 250_000], 32);
    extractEcologicalFeatures(state);
    const forest = Object.values(state.domain.world.features).find((f) => f.kind === "forest")!;
    expect(forest).toBeDefined();
    // Adjacent tiles and two pixel resolutions sample the same geographic transition.
    for (const size of [16, 32])
      for (const west of [250_000, 325_000]) {
        const extent = [west, 150_000, west + 75_000, 250_000],
          values = sample(extent, size);
        for (let pixel = 0; pixel < size * size; pixel++) {
          const row = Math.floor(pixel / size),
            col = pixel % size;
          const p = {
              x: west + ((col + 0.5) * 75_000) / size,
              y: 250_000 - ((row + 0.5) * 100_000) / size,
              z: 0,
            },
            offset = pixel * terrainSampleBands;
          expect(values[offset + 1]).toBe(1);
          expect(values[offset + 6]).toBe(values[offset + 7]);
          expect(spatial.intersects(forest.geometry, point(p))).toBe(
            values[offset + 7] === surfaceCode("Temperate forest")
          );
        }
      }
    expect(sample([250_000, 150_000, 400_000, 250_000], 32)).toEqual(before);
  }
});
