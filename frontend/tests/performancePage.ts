import "ol/ol.css";
import { createWorld, session } from "../src/atlasState";
import { readScene } from "../src/atlasReads";
import { createMap, fitArea, updateFeatures } from "../src/mapEngine";
import { updateRaster } from "../src/rasterLayers";
import { defaultStyles } from "../src/presentation";
import { defaultFieldStyle, defaultRasterPresentation } from "../src/rasterPresentation";
import { numericTileSampler } from "../src/numericTiles";
import { terrainTile } from "../src/terrainTile";
import { areaSpace, type Grid } from "@atlas/domain";
import type { AtlasFeature, Raster, World, Area } from "../src/types";

export interface PerformanceScene {
  grid: Grid;
  features: Record<string, AtlasFeature>;
  reference?: Pick<World["reference"], "boundaryMode">;
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
      algorithm: "constructed-rendering-fixture",
      source: { kind: "run", id: "rendering-fixture" },
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
  const values = sample([0, 0, 1000, 1000], 258);
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
function boundaryState(engine: ReturnType<typeof createMap>, world: World) {
  return {
    mode: world.reference.boundaryMode,
    wraps: engine.map.getView().getProjection().canWrapX(),
    vectorWraps: [...engine.featureLayers.values()].every((l) => l.getSource()!.getWrapX()),
    center: engine.map.getView().getCenter(),
  };
}
function boundaryEngine(
  input: PerformanceScene,
  world: World,
  engine: ReturnType<typeof createMap>
) {
  const mode = input.reference?.boundaryMode ?? "none";
  if (mode === world.reference.boundaryMode) return engine;
  disposeMap(engine);
  world.reference = { ...world.reference, boundaryMode: mode };
  return createMap(document.getElementById("map")!, world.reference);
}
function benchmark() {
  const world = createWorld({
    name: "Constructed rendering",
    seed: 104729,
    width: 1000,
    height: 1000,
  });
  const area = Object.values(world.areas)[0];
  let engine = createMap(document.getElementById("map")!, world.reference);
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
      engine = boundaryEngine(input, world, engine);
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
    boundary() {
      return boundaryState(engine, world);
    },
    sample: () => sampleRaster(data.find((r) => r.channel === "elevation")!),
    observe: () => renderMap(engine),
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
