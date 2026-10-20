import "ol/ol.css";
import { createWorld, session } from "../src/atlasState";
import { readScene, readRaster } from "../src/atlasReads";
import { createMap, fitArea, updateFeatures } from "../src/mapEngine";
import { updateRaster } from "../src/rasterLayers";
import { defaultStyles } from "../src/presentation";
import { defaultFieldStyle, defaultRasterPresentation } from "../src/rasterPresentation";
import { numericTileSampler } from "../src/numericTiles";
import { terrainTile } from "../src/terrainTile";
import { areaSpace, type Grid } from "@atlas/domain";
import { refineScene } from "./performanceRefinement";
import type { AtlasFeature, Raster, World, Area } from "../src/types";

export interface PerformanceScene {
  grid: Grid;
  features: Record<string, AtlasFeature>;
}
export interface NavigationMeasurement {
  first: number;
  settled: number;
}
declare global {
  interface Window {
    atlasBenchmark: ReturnType<typeof benchmark>;
  }
}
function loadScene(input: PerformanceScene, world: World, area: Area): Raster[] {
  const grid = input.grid;
  grid.scope = {
    ...grid.scope,
    worldId: world.id,
    areaId: area.id,
    spaceId: areaSpace(world, area.id),
    crsId: world.reference.id,
  };
  world.features = Object.fromEntries(
    Object.values(input.features).map((feature) => [feature.id, { ...feature, areaId: area.id }])
  );
  session(world.id).snapshot.world = world;
  session(world.id).snapshot.numerical[grid.id] = grid;
  world.featureCount = Object.keys(world.features).length;
  world.fields = [
    {
      id: grid.id,
      areaId: area.id,
      spaceId: grid.scope.spaceId,
      layerId: "elevation",
      algorithm: "completed-real-world",
      source: { kind: "run", id: "performance-replay" },
      channels: Object.keys(grid.channels),
      samples: grid.active.length,
    },
  ];
  return Object.keys(grid.channels)
    .filter((c) => grid.units[c] !== "cell-index")
    .map((channel) => ({
      id: grid.id,
      areaId: area.id,
      footprint: grid.scope.footprint,
      bounds: grid.bounds,
      channel,
      field: grid,
      water: grid,
      ice: grid,
      lakes: Object.values(world.features)
        .filter((f) => f.kind === "lake")
        .map((f) => ({ geometry: f.geometry, level: Number(f.attributes.waterLevel) })),
    }));
}
function sampleRaster(raster: Raster) {
  const sample = numericTileSampler(raster);
  const start = performance.now();
  const values = sample([1e6, 1e6, 1.4e6, 1.4e6], 258);
  const sampled = performance.now();
  terrainTile(values, 258);
  return { sampling: sampled - start, gradients: performance.now() - sampled };
}
function renderMap(engine: ReturnType<typeof createMap>, change?: () => void) {
  return new Promise<NavigationMeasurement>((resolve) => {
    const start = performance.now();
    let first = 0;
    engine.map.once("postrender", () => {
      first = performance.now() - start;
    });
    engine.map.once("rendercomplete", () => resolve({ first, settled: performance.now() - start }));
    if (change) {
      change();
      engine.map.render();
    }
  });
}
function disposeMap(engine: ReturnType<typeof createMap>) {
  engine.map.setTarget(undefined);
  engine.map.getAllLayers().forEach((l) => l.dispose());
  engine.map.dispose();
}
function benchmark() {
  let world = createWorld({ name: "Real Draft", seed: 104729, width: 4e6, height: 3e6 });
  let area = Object.values(world.areas)[0];
  const engine = createMap(document.getElementById("map")!, world.reference);
  const view = defaultRasterPresentation();
  let data: Raster[] = [];
  const scene = () =>
    updateFeatures(engine, world, area, defaultStyles(world), readScene(world.id, area.id));
  const appearance = () =>
    updateRaster(
      engine,
      world,
      data,
      data.filter((r) => r.channel === "elevation"),
      view
    );
  const render = (change: () => void) => renderMap(engine, change);
  return {
    async load(input: PerformanceScene) {
      data = loadScene(input, world, area);
      return render(() => {
        scene();
        appearance();
        fitArea(engine, area);
      });
    },
    navigate(center: number[], resolution: number) {
      return render(() => {
        engine.map.getView().setCenter(center);
        engine.map.getView().setResolution(resolution);
      });
    },
    sample() {
      return sampleRaster(data.find((r) => r.channel === "elevation")!);
    },
    observe() {
      return renderMap(engine);
    },
    async refine() {
      ({ world, area } = await refineScene(world));
      data = world.fields.flatMap((f) =>
        (f.channels ?? []).map((channel) => readRaster(world.id, f.id, channel))
      );
      return render(() => {
        scene();
        appearance();
        fitArea(engine, area);
      });
    },
    base() {
      return render(() => {
        view.base = view.base === "relief" ? "topographic" : "relief";
        appearance();
      });
    },
    overlay() {
      return render(() => {
        view.fields = view.fields.length
          ? []
          : [defaultFieldStyle("temperature"), defaultFieldStyle("flow")];
        appearance();
      });
    },
    dispose() {
      disposeMap(engine);
    },
    async editor() {
      disposeMap(engine);
      document.body.innerHTML = '<div id="root"></div>';
      await import("../src/main");
    },
  };
}
window.atlasBenchmark = benchmark();
