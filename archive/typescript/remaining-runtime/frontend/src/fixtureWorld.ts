import { create_generation_world } from "@atlas/engine";
import type { World, SpatialScope } from "@atlas/domain";

export function fixtureDocument(input: {
  name: string;
  seed: number;
  width: number;
  height: number;
}) {
  return JSON.parse(
    create_generation_world(
      JSON.stringify({
        ...input,
        id: crypto.randomUUID(),
        settings: null,
        boundaryMode: "none",
      })
    )
  ) as { world: World; scope: SpatialScope; fieldPatches: [] };
}
export function fixtureWorld(input: Parameters<typeof fixtureDocument>[0]) {
  return fixtureDocument(input).world;
}
