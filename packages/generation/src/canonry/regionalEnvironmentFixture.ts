import {
  canonryMagicPresets,
  createGrid,
  gridPosition,
  putChannel,
  resampleChannels,
  type Grid,
  type MagicSystem,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createField } from "./field";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { nearestTriangle } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";

function seedChannels(parent: Grid, systems: MagicSystem[], enabled: boolean) {
  const channel = (key: string, unit: string, value: number) =>
    putChannel(parent, key, unit, new Float64Array(10).fill(value));
  channel("elevation", "metre", 100);
  channel("temperature", "celsius", 10);
  channel("rainfall", "metre/year", 1);
  channel("moisture", "ratio", 0.7);
  for (const system of systems) {
    channel(`magic:${system.id}:intensity`, "relative-intensity", enabled ? 200 : 0);
    channel(`magic:${system.id}:source`, "relative-intensity", enabled ? 200 : 0);
    channel(`magic:${system.id}:history`, "relative-intensity", 400);
    channel(`magic:${system.id}:firstEpoch`, "category", 2);
    for (const origin of system.origins) {
      channel(
        `magic:${system.id}:origin:${origin.id}:source`,
        "relative-intensity",
        enabled ? 200 : 0
      );
      for (const stock of origin.stocks.length ? origin.stocks : [{ id: "held" }])
        putChannel(
          parent,
          `magic:${system.id}:stock:${origin.id}/${stock.id}`,
          "intensity-square-metre",
          Float64Array.from(parent.measures, (area) => (enabled ? area * 3 : 0)),
          "extensive"
        );
    }
  }
}
/** A supplied temperate slope with old habitat and material inventories, with no upstream generation. */
export function regionalEnvironmentFixture(enabled = true) {
  const state = landscape(),
    parent = state.surface,
    world = state.domain.world;
  world.magicSystems = canonryMagicPresets().map((system) => ({ ...system, enabled }));
  seedChannels(parent, world.magicSystems, enabled);
  state.domain.numerical.parent = parent;
  world.fields = [
    {
      id: "parent",
      areaId: "area",
      layerId: "physical",
      algorithm: "fixture",
      source: { kind: "operation", id: "fixture" },
      samples: 10,
      channels: Object.keys(parent.channels),
    },
  ];
  world.areas.child = { ...world.areas.area, id: "child", parentId: "area", profile: "region" };
  state.domain.scope = { ...state.domain.scope, areaId: "child", resolution: 250 };
  state.surface = createGrid("child", state.domain.scope, 17, 5);
  resampleChannels(parent, state.surface);
  const map = createField(
    createAdaptiveWorldMesh(
      parent.bounds,
      { maximumSize: 250, minimumSize: 250, refine: () => false },
      0
    )
  );
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: Int32Array.from(state.surface.active, (_, i) => {
      const p = gridPosition(state.surface, i);
      return nearestTriangle(map.mesh, p.x - map.mesh.origin[0], p.y - map.mesh.origin[1]);
    }),
    fixed: [],
    inherited: true,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  for (let i = 0; i < map.mesh.count; i++) {
    map.Elevation[i] = map.BedrockElevation[i] = 100 * 1024;
    map.Temperature[i] = 400;
    map.Rainfall[i] = 1000;
    map.Moisture[i] = 700;
    map.RockResistance[i] = 1000;
    map.FractureConductance[i] = 900;
    map.CanopyAge[i] = 80;
    map.BroadleafCover[i] = map.TreeCover[i] = 0.7;
    map.IceThickness[i] = 300;
  }
  return { state, map, parent };
}
