import { expect, it } from "vitest";
import { generateAtlas, type GenerationState } from "@atlas/generation";
import { spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import { createRiverPaths, riverPath } from "../../packages/generation/src/canonry/riverPaths";
import type { AtlasPhysicalWorkspace } from "../../packages/generation/src/canonry/atlasWorkspace";
import type { PhysicalField } from "../../packages/generation/src/canonry/field";
import { createWorld, session } from "./atlasState";

async function generated() {
  const world = createWorld({ name: "Coasts", seed: 104729, width: 4_000_000, height: 3_000_000 });
  const domain = session(world.id).snapshot;
  let physical: AtlasPhysicalWorkspace | undefined, state: GenerationState | undefined;
  await generateAtlas(
    domain,
    { areaId: domain.scope.areaId, quality: "draft", seed: world.seed, domains: ["physical"] },
    {
      async saveBoundary(boundary) {
        physical = boundary.state.physical ?? physical;
        if (boundary.kind === "final") state = boundary.state;
      },
    }
  );
  return { map: physical!.map, state: state! };
}
const centre = (map: PhysicalField, i: number) => ({
  x: map.mesh.x[i] + map.mesh.origin[0],
  y: map.mesh.y[i] + map.mesh.origin[1],
  z: 0,
});
/** Reaches exactly as extraction forms them: they end at a confluence or their first water cell. */
function* reaches(map: PhysicalField) {
  const incoming = new Int32Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const j = map.FlowTargets[i];
    if (map.RiverOrders[i] > 0 && j >= 0 && map.RiverOrders[j] > 0) incoming[j]++;
  }
  const continues = (j: number) =>
    map.WaterKindCodes[j] === 0 && map.RiverOrders[j] > 0 && incoming[j] === 1;
  for (let start = 0; start < map.mesh.contentCount; start++) {
    if (map.RiverOrders[start] <= 0 || incoming[start] === 1) continue;
    const members = [start];
    for (let i = start; map.FlowTargets[i] >= 0; i = members.at(-1)!) {
      members.push(map.FlowTargets[i]);
      if (!continues(map.FlowTargets[i])) break;
    }
    yield members;
  }
}
/** Dry until the mouth, then entering the water on the shore cell's edge with its receiving cell. */
function expectMouth(map: PhysicalField, members: number[], line: number[][], shape: Geometry) {
  const covers = spatial.pointCoverage(shape),
    wet = ([x, y]: number[]) => covers({ x, y, z: 0 }),
    end = line.at(-1)!;
  expect(line.slice(0, -1).filter(wet)).toEqual([]);
  const [dx, dy] = [end[0] - line.at(-2)![0], end[1] - line.at(-2)![1]],
    step = 50 / Math.hypot(dx, dy);
  expect(wet([end[0] + dx * step, end[1] + dy * step])).toBe(true);
  const a = centre(map, members.at(-2)!),
    b = centre(map, members.at(-1)!);
  const t =
    ((end[0] - a.x) * (b.x - a.x) + (end[1] - a.y) * (b.y - a.y)) /
    ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  expect(t).toBeGreaterThanOrEqual(-0.25);
  expect(t).toBeLessThanOrEqual(1.25);
}

it("presents the ocean and river mouths where generation placed them", async () => {
  const { map, state } = await generated(),
    ocean = state.surface.ocean!,
    sea = spatial.pointCoverage(ocean),
    onMap = spatial.pointCoverage(state.domain.scope.footprint);

  // Enclosed basins below sea level are not ocean-connected in generation and are not sea.
  const enclosed = Array.from({ length: map.mesh.contentCount }, (_, i) => i).filter(
    (i) => map.Elevation[i] < map.EffectiveSeaLevel && map.WaterKindCodes[i] !== 1
  );
  expect(enclosed.length).toBeGreaterThan(0);
  expect(enclosed.filter((i) => sea(centre(map, i)))).toEqual([]);

  const lakes = new Map<number, Geometry>(
    Object.values(state.domain.world.features)
      .filter((feature) => feature.kind === "lake")
      .map((feature) => [Number(feature.attributes.waterBody), feature.geometry])
  );
  const paths = createRiverPaths(map);
  paths.water = { ocean, lakes };
  let mouths = 0;
  for (const members of reaches(map)) {
    const last = members.at(-1)!;
    if (members.length < 2 || map.WaterKindCodes[last] === 0) continue;
    const shape = map.WaterKindCodes[last] === 1 ? ocean : lakes.get(map.WaterBodyIds[last]);
    // Reaches leaving the map are clipped at the footprint on publication.
    if (!shape || !onMap(centre(map, last))) continue;
    expectMouth(map, members, riverPath(map, paths, members).geometry.coordinates, shape);
    mouths++;
  }
  expect(mouths).toBeGreaterThan(100);

  // The stored network keeps every channel the map hides, connected downstream.
  const network = state.domain.world.drainage![state.domain.scope.areaId].reaches,
    rivers = Object.values(state.domain.world.features).filter((f) => f.kind === "river");
  expect(network).toHaveLength([...reaches(map)].length);
  expect(network.filter((reach) => reach.featureIds.length).length).toBeLessThan(network.length);
  expect(new Set(network.flatMap((reach) => reach.featureIds))).toEqual(
    new Set(rivers.map((river) => river.id))
  );
  for (const reach of network) {
    expect(reach.discharges).toHaveLength(reach.coordinates.length);
    if (reach.downstream === null) continue;
    const below = network[reach.downstream];
    expect(below.coordinates[0]).toEqual(reach.coordinates.at(-1));
    expect(below.discharges[0]).toBeGreaterThanOrEqual(reach.discharges.at(-1)!);
  }
}, 300_000);
