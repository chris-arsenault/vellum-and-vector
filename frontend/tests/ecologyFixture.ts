import { builtinLayers, createAdaptiveField, createAdaptiveTopology } from "@atlas/domain";
import { landscape } from "../../packages/generation/src/mapFixtures";
import { adaptivePhysicalMesh } from "../../packages/generation/src/canonry/adaptiveMesh";
import { createField } from "../../packages/generation/src/canonry/field";
import { atlasPhysicalProfile } from "../../packages/generation/src/canonry/atlasProfile";
import {
  extractEcologicalFeatures,
  prepareEcologicalRegions,
} from "../../packages/generation/src/canonry/ecologyFeatures";
import { refreshWorkspaceSamples } from "../../packages/generation/src/canonry/atlasWorkspace";
import { projectNative } from "../../packages/generation/src/canonry/atlasProjection";
import { preparePhysicalChannels } from "../../packages/generation/src/canonry/continuousState";
import { ecologyProcesses } from "../../packages/generation/src/canonry/ecologyProcesses";
import { executeProcessBehavior } from "../../packages/generation/src/processTraits";
import type { MapProcessContext } from "../../packages/generation/src/process";

/** Ecological processes grow a small scene across a controlled rainfall gradient. */
export function ecologicalPolygons() {
  const state = landscape();
  state.domain.world.id = "00000000-0000-4000-8000-000000000001";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  const topology = createAdaptiveTopology(state.surface.bounds, {
    maximumSize: 250,
    minimumSize: 250,
  });
  state.surface = createAdaptiveField("ecological-gis", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    fixed: [],
    inherited: false,
    samples: map.mesh.leafToCell,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  map.Elevation.fill(100 * 1024);
  map.Temperature.fill(450);
  map.Slope.fill(0.02);
  map.SedimentThickness.fill(10 * 1024);
  map.BroadleafSeed.fill(0.08);
  map.ConiferSeed.fill(0.08);
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i] + map.mesh.origin[0],
      y = map.mesh.y[i] + map.mesh.origin[1];
    map.Rainfall[i] = 1200 - (1050 * x) / 4000 + 100 * Math.sin(y / 300);
  }
  refreshWorkspaceSamples(state, state.physical);
  preparePhysicalChannels(map, []);
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: ["ecology"],
    parameters: {},
    epochs: [{ id: "growth", duration: 1000, parentEpoch: null, variables: {} }],
    epochIndices: [0],
    causes: [],
    recordCause: () => {},
    random: () => 0.5,
    cancelled: () => false,
    progress: () => {},
  };
  const processes = ecologyProcesses({
    areaId: "area",
    quality: "draft",
    seed: 42,
    domains: ["physical"],
  });
  for (const name of ["initialize", "evolve", "respond", "present"]) {
    const process = processes.find((p) => p.contract.id === `atlas.ecology-${name}`)!;
    executeProcessBehavior(process, state, context);
    process.prepareFields?.(state);
  }
  projectNative(state);
  prepareEcologicalRegions(state);
  extractEcologicalFeatures(state);
  return { features: Object.values(state.domain.world.features), surface: state.surface };
}
