import {
  builtinLayers,
  createAdaptiveField,
  createAdaptiveTopology,
  rectangle,
  residentBand,
  type Bounds,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";

/** Supplied geography only: no schedule, climate pass, hydrology or world generation. */
export function worldGeographyFixture(bounds: Bounds = [0, 0, 600_000, 400_000], size = 25_000) {
  const state = landscape(),
    footprint = rectangle(bounds);
  state.domain.scope.footprint = footprint;
  state.domain.world.reference.domain = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  const topology = createAdaptiveTopology(bounds, { maximumSize: size, minimumSize: size });
  state.surface = createAdaptiveField("world-geography", state.domain.scope, topology);
  const mesh = adaptivePhysicalMesh(topology, footprint),
    map = createField(mesh);
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    fixed: [],
    inherited: false,
    samples: residentBand("int32", mesh.leafCells()),
    grid: state.surface.coverage,
    sampling: { maximumSize: size, minimumSize: size, featureSamples: 2 },
  };
  map.Elevation.fill(100 * 1024);
  map.DrainageElevations.copyFrom(map.Elevation);
  map.Temperature.fill(450);
  map.Rainfall.fill(800);
  map.Slope.fill(0.005);
  map.FlowTargets.fill(-1);
  return state;
}
