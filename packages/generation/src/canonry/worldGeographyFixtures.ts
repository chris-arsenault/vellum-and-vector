import {
  builtinLayers,
  createAdaptiveField,
  createAdaptiveTopology,
  rectangle,
  spatial,
  type Bounds,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { refreshWorkspaceSamples, type AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { createWorldMesh } from "./worldMesh";
import type { Geometry } from "geojson";

/** Supplied geography only: no schedule, climate pass, hydrology or world generation. */
export function worldGeographyFixture(
  bounds: Bounds = [0, 0, 600_000, 400_000],
  size = 25_000,
  footprint: Geometry = rectangle(bounds)
) {
  const state = landscape();
  state.domain.scope.footprint = footprint;
  state.domain.world.reference.domain = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  const topology = createAdaptiveTopology(bounds, { maximumSize: size, minimumSize: size });
  state.surface = createAdaptiveField("world-geography", state.domain.scope, topology);
  // The map's own lattice at the cell size, projected onto the display surface as in a run.
  const covers = spatial.pointCoverage(footprint),
    mesh = createWorldMesh(
      bounds,
      ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / size ** 2,
      0,
      (x, y) => covers({ x, y, z: 0 })
    ),
    map = createField(mesh),
    work: AtlasPhysicalWorkspace = {
      map,
      profile: atlasPhysicalProfile(),
      fixed: [],
      inherited: false,
      samples: state.surface.coverage.scratch("int32", "physical:samples", 0),
      grid: state.surface.coverage,
    };
  refreshWorkspaceSamples(state, work);
  state.physical = work;
  map.Elevation.fill(100 * 1024);
  map.DrainageElevations.copyFrom(map.Elevation);
  map.Temperature.fill(450);
  map.Rainfall.fill(800);
  map.Slope.fill(0.005);
  map.FlowTargets.fill(-1);
  return state;
}
