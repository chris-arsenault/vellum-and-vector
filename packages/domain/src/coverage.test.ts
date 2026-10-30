import { expect, it } from "vitest";
import { createWorldBlueprint } from "./worldCreation";
import { validateCoverage, type MaterializedCoverage } from "./coverage";
import { rectangle } from "./spatial";

function fixture() {
  const b = createWorldBlueprint({
      id: crypto.randomUUID(),
      name: "Independent coverage",
      seed: 1,
      reference: {
        id: "metres",
        domain: rectangle([0, 0, 10000, 10000]),
        topology: "planar",
        units: "metre",
        axes: "east,north,up",
        verticalDatum: "sea",
        version: 1,
        precision: 1e-6,
      },
    }),
    child = {
      ...b.root,
      id: "child",
      parentId: b.root.id,
      profile: "region" as const,
      footprint: rectangle([1000, 1000, 2000, 2000]),
      map: { sourceAreaId: b.root.id, sourceRevision: 1 },
    },
    world = { id: b.id, reference: b.reference, areas: { [b.root.id]: b.root, child } },
    coverage: MaterializedCoverage = {
      id: "surface",
      areaId: child.id,
      spaceId: b.root.spaceId!,
      layerId: "elevation",
      detailRank: 1,
      resolution: 100,
      time: "present",
      footprint: rectangle([500, 500, 2500, 2500]),
      state: "generated",
      resourceId: "local-surface",
      generationId: "local-refinement",
    };
  return { world, coverage };
}

it("publishes independent geography beyond its initial outline while retaining ownership checks", () => {
  const { world, coverage } = fixture();
  expect(() => validateCoverage(world, coverage, [])).not.toThrow();
  expect(() => validateCoverage(world, { ...coverage, spaceId: "elsewhere" }, [])).toThrow(
    "Materialization ownership"
  );
  expect(() => validateCoverage(world, { ...coverage, detailRank: 0 }, [])).toThrow(
    "Materialization ownership"
  );
  const legacy = {
    ...world,
    areas: { ...world.areas, child: { ...world.areas.child, map: undefined } },
  };
  expect(() => validateCoverage(legacy, coverage, [])).toThrow("within its mapped area");
});
