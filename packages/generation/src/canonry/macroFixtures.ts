import { createGrid, gridPosition, rectangle } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { refreshWorkspaceSamples } from "./atlasWorkspace";
import { beginFinishing } from "./macroTerrain";
import { nearestTriangle } from "./mesh";

/** Direct evolved landscape: no epochs or browser are needed to exercise finishing. */
export function macroFixture(samples = 2048) {
  const state = landscape(),
    footprint = rectangle([-100_000, -100_000, 100_000, 100_000]);
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.scope = { ...state.domain.scope, footprint };
  state.domain.world.areas.area.footprint = footprint;
  state.domain.world.reference.domain = footprint;
  state.surface = createGrid("macro", state.domain.scope, 65, 65);
  const mesh = createWorldMesh([-100_000, -100_000, 100_000, 100_000], samples, 0),
    map = createField(mesh);
  for (let i = 0; i < mesh.count; i++) {
    map.Elevation[i] =
      (100 + 1500 * Math.exp(-((mesh.x[i] / 20_000) ** 2)) + (mesh.y[i] / 60_000) ** 2 * 500) *
      1024;
    map.BedrockElevation[i] = map.Elevation[i];
    map.DrainageElevations[i] = map.Elevation[i];
    map.RockResistance[i] = 1000;
    map.SoilDepth[i] = 1;
    map.Moisture[i] = 600;
    map.Temperature[i] = 450;
  }
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    fixed: [],
    inherited: false,
    samples: Int32Array.from(state.surface.active, (_, i) => {
      const p = gridPosition(state.surface, i);
      return nearestTriangle(mesh, p.x, p.y);
    }),
    sampling: { maximumSize: mesh.spacing, minimumSize: mesh.spacing, featureSamples: 2 },
  };
  refreshWorkspaceSamples(state, state.physical);
  beginFinishing(state.physical, state.surface);
  return state;
}
