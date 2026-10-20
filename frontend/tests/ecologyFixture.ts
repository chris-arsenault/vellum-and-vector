import { builtinLayers, createAdaptiveField, createAdaptiveTopology } from "@atlas/domain";
import { landscape } from "../../packages/generation/src/mapFixtures";
import { adaptivePhysicalMesh } from "../../packages/generation/src/canonry/adaptiveMesh";
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
    samples: map.mesh.leafToCell,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  map.Elevation.fill(100 * 1024);
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i] + map.mesh.origin[0];
    map.BiomeCodes[i] = x < 1250 ? 10 : x < 2750 ? 7 : 15;
    map.TreeCover[i] = map.BiomeCodes[i] === 7 ? 0.1 : 0.7;
    map.GrassCover[i] = map.BiomeCodes[i] === 7 ? 0.8 : 0.1;
    map.AlteredCover[i] = map.BiomeCodes[i] === 15 ? 0.7 : 0;
  }
  extractEcologicalFeatures(state);
  return Object.values(state.domain.world.features);
}
