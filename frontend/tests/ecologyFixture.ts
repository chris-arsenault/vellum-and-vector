import { builtinLayers, createAdaptiveField, createAdaptiveTopology } from "@atlas/domain";
import { landscape } from "../../packages/generation/src/mapFixtures";
import {
  adaptivePhysicalMesh,
  type AdaptiveLattice,
} from "../../packages/generation/src/canonry/adaptiveMesh";
import { createField } from "../../packages/generation/src/canonry/field";
import { atlasPhysicalProfile } from "../../packages/generation/src/canonry/atlasProfile";
import { extractEcologicalFeatures } from "../../packages/generation/src/canonry/ecologyFeatures";

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
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    fixed: [],
    inherited: false,
    samples: (map.mesh as AdaptiveLattice).leafCells(),
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
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
  extractEcologicalFeatures(state);
  return Object.values(state.domain.world.features);
}
