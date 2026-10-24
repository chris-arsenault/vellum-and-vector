import { describe, expect, it } from "vitest";
import {
  availableRegionFootprint,
  regionCandidates,
  regionFaces,
  regionLineage,
  rectangle,
  spatial,
  snapRegionCut,
} from "@atlas/domain";
import { createWorld, session, undoWorld } from "./atlasState";
import { commitCommand } from "./atlasCommands";
import { exportWorld, readScene } from "./atlasReads";
import type { Geometry } from "geojson";

function fixture() {
  const world = createWorld({
    name: "Source atlas",
    seed: 13,
    width: 10_000_000,
    height: 10_000_000,
  });
  const areaId = Object.keys(world.areas)[0];
  const put = (data: Record<string, unknown>, kind = "putView") =>
    commitCommand(world.id, {
      operationId: crypto.randomUUID(),
      expectedVersion: session(world.id).snapshot.world.version,
      kind,
      data,
    });
  const region = (name: string, footprint: Geometry, parentId: string | null = null) => {
    const id = crypto.randomUUID();
    put({ id, name, areaId, layers: [], region: { parentId, footprint } });
    return id;
  };
  return { world, areaId, put, region };
}
function existingGeography(f: ReturnType<typeof fixture>) {
  f.put({ areaId: f.areaId, layerId: "elevation", resolution: 9, value: 7 }, "createField");
  f.put(
    {
      areaId: f.areaId,
      feature: {
        id: crypto.randomUUID(),
        name: "Existing place",
        kind: "poi",
        layerId: "pois",
        geometry: { type: "Point", coordinates: [1000, 1000] },
        attributes: {},
        relations: [],
        protected: true,
      },
    },
    "putFeature"
  );
}

describe("source-preserving geographic region views", () => {
  it("supports arbitrary named and unnamed-depth regions without changing geography or detail eligibility", () => {
    const f = fixture();
    existingGeography(f);
    const before = session(f.world.id).snapshot;
    const scene = readScene(f.world.id, f.areaId);
    let parent: string | null = null;
    for (let i = 1; i <= 12; i++) {
      const span = 10_000_000 / 2 ** i;
      parent = f.region(i % 2 ? "The reach" : `Area ${i}`, rectangle([0, 0, span, span]), parent);
    }
    const after = session(f.world.id).snapshot;
    expect(regionLineage(after.world, parent)).toHaveLength(12);
    expect(after.world.areas).toEqual(before.world.areas);
    expect(after.world.features).toEqual(before.world.features);
    expect(after.world.fields).toEqual(before.world.fields);
    expect(after.numerical).toEqual(before.numerical);
    expect(after.world.generations).toEqual([]);
    expect(readScene(f.world.id, f.areaId)).toEqual(scene);
    expect(exportWorld(f.world.id).regions).toHaveLength(12);
    undoWorld(f.world.id, session(f.world.id).history[0].operationId);
    expect(session(f.world.id).snapshot.world.views).toHaveLength(11);
  });
  it("validates smaller contained regions, useful width, cycles and source-map identity", () => {
    const f = fixture(),
      id = f.region("First", rectangle([0, 0, 4000, 4000]));
    const view = session(f.world.id).snapshot.world.views[0];
    expect(() => f.region("Too thin", rectangle([0, 0, 10, 4000]), id)).toThrow(/width/);
    expect(() => f.region("Outside", rectangle([0, 0, 5000, 5000]), id)).toThrow(/inside/);
    expect(() => f.region("Same", rectangle([0, 0, 4000, 4000]), id)).toThrow(/smaller/);
    expect(() => f.put({ ...view, region: { ...view.region, parentId: id } })).toThrow(/cycle/);
    const child = f.region("Next", rectangle([0, 0, 2000, 2000]), id);
    expect(() => f.put({ ...view, region: { ...view.region, parentId: child } })).toThrow(/cycle/);
    expect(() => f.put({ id }, "removeView")).toThrow(/children/);
    expect(() =>
      f.put({ ...view, region: { ...view.region, footprint: rectangle([2500, 2500, 4000, 4000]) } })
    ).toThrow(/child/);
  });
  it("reuses sibling borders and keeps cartographic compositions linked to their subject", () => {
    const f = fixture(),
      parent = f.region("Coast country", rectangle([0, 0, 10_000, 10_000]));
    const west = f.region("West", rectangle([0, 0, 5000, 10_000]), parent);
    const world = session(f.world.id).snapshot.world;
    expect(availableRegionFootprint(world, f.areaId, parent)).toEqual(
      spatial.canonical(rectangle([5000, 0, 10_000, 10_000]))
    );
    expect(() => f.region("Overlapping", rectangle([4000, 0, 6000, 10_000]), parent)).toThrow(
      /sibling/
    );
    f.region("East", rectangle([5000, 0, 10_000, 10_000]), parent);
    expect(
      availableRegionFootprint(session(f.world.id).snapshot.world, f.areaId, parent)
    ).toBeNull();
    f.put({
      id: crypto.randomUUID(),
      name: "Political sheet",
      areaId: f.areaId,
      regionId: west,
      layers: [],
    });
    expect(() => f.put({ id: west }, "removeView")).toThrow(/saved map views/);
  });
});

describe("geographic boundary composition", () => {
  const parent: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [9000, 0],
        [10_000, 6000],
        [6000, 10_000],
        [0, 10_000],
        [0, 0],
      ],
    ],
  };
  const river: Geometry = {
    type: "LineString",
    coordinates: [
      [4000, -100],
      [4000, 11_000],
    ],
  };
  const cut: Geometry = {
    type: "LineString",
    coordinates: [
      [-100, 5000],
      [11_000, 5000],
    ],
  };
  it("composes a nonrectangular shoreline, river and authored cut into shared polygon faces", () => {
    const faces = regionFaces(parent, [river, cut]);
    expect(faces).toHaveLength(4);
    expect(faces.reduce((area, f) => area + spatial.area(f), 0)).toBeCloseTo(spatial.area(parent));
    for (const face of faces) expect(spatial.covers(parent, face)).toBe(true);
    expect(
      faces.every((f) => f.coordinates.flat().some(([x, y]) => x === 4000 && y === 5000))
    ).toBe(true);
  });
  it("ranks useful candidates by viewport scale and takes the component under the pointer", () => {
    const forest = rectangle([1000, 1000, 3000, 3000]);
    const candidates = regionCandidates(
      parent,
      [{ name: "Woodland", footprint: forest }],
      [],
      { x: 2000, y: 2000, z: 0 },
      [0, 0, 3500, 3500]
    );
    expect(candidates[0].name).toBe("Woodland");
    expect(candidates).toHaveLength(1);
  });
  it("snaps cut endpoints to the existing parent edge without moving interior bends", () => {
    const line = snapRegionCut(
      {
        type: "LineString",
        coordinates: [
          [20, 5000],
          [2000, 5100],
          [8990, 0],
        ],
      },
      [parent],
      30
    );
    expect(line.coordinates).toEqual([
      [0, 5000],
      [2000, 5100],
      [8990, 0],
    ]);
  });
});
