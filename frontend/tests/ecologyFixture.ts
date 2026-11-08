import { builtinLayers, createAdaptiveField, createAdaptiveTopology, spatial } from "@atlas/domain";
import { landscape } from "../../packages/generation/src/mapFixtures";
import { createWorldMesh } from "../../packages/generation/src/world/worldMesh";
import {
  refreshWorkspaceSamples,
  type AtlasPhysicalWorkspace,
} from "../../packages/generation/src/world/atlasWorkspace";
import { createTestField as createField } from "../../packages/generation/src/rock/groundTestFixture";
import { atlasPhysicalProfile } from "../../packages/generation/src/world/atlasProfile";
import { publishKinds } from "../../packages/generation/src/poi/poiPublish";

/** Real ecological polygon extraction on small, controlled communities for the GIS journey. */
export function ecologicalPolygons() {
  const state = landscape();
  state.domain.world.id = "00000000-0000-4000-8000-000000000001";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  const topology = createAdaptiveTopology(state.surface.bounds, {
    maximumSize: 250,
    minimumSize: 250,
  });
  state.surface = createAdaptiveField("ecological-gis", state.domain.scope, topology);
  // The map's own lattice at the cell size, projected onto the display surface as in a run.
  const bounds = state.surface.bounds,
    covers = spatial.pointCoverage(state.domain.scope.footprint),
    map = createField(
      createWorldMesh(
        bounds,
        ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / 250 ** 2,
        0,
        (x, y) => covers({ x, y, z: 0 })
      )
    ),
    work: AtlasPhysicalWorkspace = {
      map,
      profile: atlasPhysicalProfile({}, {}, map.scale),
      fixed: [],
      inherited: false,
      samples: state.surface.coverage.scratch("int32", "physical:samples", 0),
      grid: state.surface.coverage,
    };
  refreshWorkspaceSamples(state, work);
  state.physical = work;
  map.Elevation.fill(100 * 1024);
  map.Temperature.fill(450);
  map.Rainfall.fill(800);
  // Forest, grassland and wetland bands, outlined from their cover.
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i) + map.mesh.origin[0],
      band = x < 1250 ? 0 : x < 2750 ? 1 : 2;
    map.BroadleafCover.set(i, band === 0 ? 0.7 : 0.05);
    map.GrassCover.set(i, band === 1 ? 0.8 : 0.1);
    map.WetlandCover.set(i, band === 2 ? 0.7 : 0);
  }
  publishKinds(state, "geography", (entry) => entry.group === "cover" || entry.id === "wetland");
  return Object.values(state.domain.world.features);
}
