import { createGrid, generateBand, gridPosition, putChannel, rectangle } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createRefinementState } from "./inputs";
import { channel } from "./state";

export function regionalFixture(
  height = (x: number, y: number) => 120 + x / 200 - y / 500,
  north = 20000
) {
  const initial = landscape(),
    source = initial.domain,
    footprint = rectangle([0, 0, 40000, north]);
  source.world.id = "df8d14c5-4f19-4f11-aa7c-fba42fbde872";
  source.world.areas.parent = { ...source.world.areas.area, id: "parent", footprint };
  source.world.areas.area = {
    ...source.world.areas.area,
    parentId: "parent",
    footprint,
    profile: "region",
    map: { sourceAreaId: "parent", sourceRevision: 1 },
  };
  source.world.reference.domain = footprint;
  source.scope.footprint = footprint;
  const grid = createGrid("captured", { ...source.scope, resolution: 5000 }, 9, 5);
  const values: Record<string, [string, (x: number, y: number) => number]> = {
    elevation: ["metre", height],
    rock: ["ratio", () => 1],
    temperature: ["celsius", () => 16],
    moisture: ["ratio", () => 0.65],
    rainfall: ["metre/year", () => 1.2],
    runoff: ["metre/year", () => 0.6],
    soilDepth: ["metre", () => 1],
    treeCover: ["ratio", () => 0.4],
  };
  for (const [name, [unit, value]] of Object.entries(values))
    putChannel(
      grid,
      name,
      unit,
      generateBand(grid.coverage, "float64", name, (i) => {
        const p = gridPosition(grid, i);
        return value(p.x, p.y);
      })
    );
  source.numerical = { captured: grid };
  source.world.fields = [
    {
      id: "captured",
      areaId: "area",
      layerId: "elevation",
      algorithm: "supplied",
      input: true,
      source: { kind: "operation", id: "supplied" },
      channels: Object.keys(values),
      samples: grid.active.length,
    },
  ];
  const input = {
    areaId: "area",
    quality: "standard",
    seed: 73,
    domains: ["physical", "magic", "built"],
  };
  return { source, input, grid, state: createRefinementState(source, input) };
}
/** Directly supplied present conditions; tests choose the real refiner they exercise. */
export function regionalEnvironment() {
  const f = regionalFixture(() => 100);
  for (const [name, unit, value] of [
    ["water", "category", 0],
    ["waterDepth", "metre", 0],
    ["slope", "ratio", 0],
    ["sediment", "metre", 0],
    ["catchmentArea", "square-metre", 1e7],
    ["riverOrder", "category", 0],
    ["fracture", "ratio", 0.2],
    ["ice", "ratio", 0],
    ["naturalSurface", "category", 28],
    ["finalSurface", "category", 28],
  ] as const)
    channel(f.state, name, unit, value);
  return f;
}
