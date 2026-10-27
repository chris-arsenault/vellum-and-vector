import { builtinLayers, createGrid, rectangle, type Bounds } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { atlasPhysicalProfile } from "./atlasProfile";
import type { PhysicalField } from "./field";

export function numericalState(map: PhysicalField, extent: Bounds) {
  const state = landscape(),
    footprint = rectangle(extent);
  state.domain.world.id = state.domain.scope.worldId = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.world.reference.domain = footprint;
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  state.domain.world.epochs = [
    {
      id: "Provided landscape",
      duration: 1000,
      tectonics: 1,
      hydrology: 1,
      ice: 1,
      coasts: 1,
      temperature: 15,
      seaLevel: 0,
    },
  ];
  state.domain.world.humanEras = [];
  state.domain.world.magicSystems = [];
  state.domain.world.areas.area.footprint = state.domain.scope.footprint = footprint;
  state.surface = createGrid("reference-surface", state.domain.scope, 16, 16);
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: new Int32Array(state.surface.active.length),
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  state.facts.clear();
  return state;
}
