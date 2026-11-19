import { describe, expect, it } from "vitest";
import type { MapDescriptor, MapFeature } from "@atlas/map";
import { heldConnections, levelName, structureLevels } from "./structureMaps";
import { vectorFamily } from "./publishedAppearance";

const space = (id: string, floor: string | null) => ({
  id,
  parentSpaceId: null,
  bounds: [0, 0, 10, 10] as [number, number, number, number],
  metresPerUnit: 1,
  precision: 1e-6,
  periodicWidth: null,
  frame: { origin: [0, 0, 0] as [number, number, number], rotation: 0, floor },
});
const floors = {
  primarySpaceId: "world",
  realScale: { kind: "structure" },
  spaces: [
    space("world", null),
    space("world:level:-1", "level:-1"),
    space("world:level:1", "level:1"),
  ],
} as unknown as MapDescriptor;

describe("structure maps", () => {
  it("lists a building's levels top floor first", () => {
    expect(structureLevels(floors).map((level) => level.label)).toEqual([
      "First floor",
      "Ground floor",
      "Cellar",
    ]);
    expect(levelName(-2)).toBe("Cellar 2");
    expect(structureLevels({ ...floors, realScale: { kind: "ground" } } as MapDescriptor)).toEqual(
      []
    );
  });
  it("reads landings and links to other maps from relations", () => {
    const feature = {
      relations: [
        { targetId: "stair", targetMapId: null, targetName: "Landing", kind: "leadsTo" },
        { targetId: "passage", targetMapId: "glen", targetName: "Rowan passage", kind: "connectsTo" },
        { targetId: "wall", targetMapId: null, targetName: "Front wall", kind: "in" },
      ],
    } as MapFeature;
    expect(heldConnections(feature).map(({ mapId, featureId }) => [mapId, featureId])).toEqual([
      [undefined, "stair"],
      ["glen", "passage"],
    ]);
  });
  it("styles a level's layers as their family", () => {
    expect(vectorFamily("vector:structures@-1")).toBe("structures");
    expect(vectorFamily("vector:hexes")).toBe("hexes");
  });
});
