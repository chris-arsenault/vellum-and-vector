import { expect, it } from "vitest";
import { createField } from "../../../packages/generation/src/world/field";
import { createMesh } from "../../../packages/generation/src/world/mesh";
import { physicalContext } from "../../../packages/generation/src/world/context";
import { physicalProfile } from "../../../packages/generation/src/world/profile";
import { setLayer } from "../../../packages/generation/src/rock/rockColumn";
import { rockCatalogue } from "../../../packages/generation/src/rock/rockCatalogue";
import { groundFixture } from "../../../packages/generation/src/rock/groundStorage";
import {
  holdRock,
  placeCarriedGround,
  releaseHeldRock,
} from "../../../packages/generation/src/rock/groundTransport";
import { groundProbe, groundProbeCells } from "./groundProbe";

it("reads an explicit bounded selection without silently accepting invalid cell IDs", () => {
  expect(groundProbeCells(" 2,3,2 ")).toEqual([2, 3]);
  expect(groundProbeCells("")).toEqual([]);
  for (const text of ["1,", "-1", "1.5", "NaN"])
    expect(() => groundProbeCells(text)).toThrow("HARNESS_GROUND_CELLS");
});

it("records the actual held donor separately from process boundaries and detaches cleanly", () => {
  const map = createField(createMesh(8, 0)),
    probe = groundProbe([1]);
  setLayer(map, 0, 0, rockCatalogue.sandstone.code, 600, { formedMin: 2, altered: 3 });
  setLayer(map, 1, 0, rockCatalogue.shale.code, 800, { formedMin: 1 });
  groundFixture(map).ThrustPairIds.set(1, 7);
  groundFixture(map).ThrustSheetIndex.set(1, 3);
  const sourceElevation = map.Elevation.get(0),
    held = holdRock(map),
    context = physicalContext(1, 0, map.scale.resolve(physicalProfile));
  try {
    probe.observe("placement", { processes: ["move"], phase: "before", substep: 0 }, map, context);
    placeCarriedGround(map, held, 1, 0, [1, 0, 0, 1]);
    probe.observe("wear", { processes: ["cut"], phase: "before", substep: 0 }, map, context);
    expect(probe.read()).toMatchObject([
      {
        kind: "process",
        step: "placement",
        ground: {
          cell: 1,
          deformation: {
            detachment: 0,
            thrustPair: 7,
            thrustSheet: 3,
            facets: [
              { facet: "land", share: 1, plane: { thickness: 0 } },
              { facet: "cut", share: 0 },
            ],
          },
        },
      },
      {
        kind: "transfer",
        phase: "before",
        source: 0,
        target: 1,
        donor: { columns: { land: [{ kind: rockCatalogue.sandstone.code, formedMin: 2 }] } },
        destination: { land: [{ kind: rockCatalogue.shale.code }] },
      },
      {
        kind: "transfer",
        phase: "after",
        operation: "plate-placement",
        source: 0,
        target: 1,
        destination: { land: [{ kind: rockCatalogue.sandstone.code, altered: 3 }] },
      },
      { kind: "process", step: "wear", ground: { cell: 1 } },
    ]);
    // The watch selection does not expand to destinations of unrelated transfers.
    placeCarriedGround(map, held, 2, 0, [1, 0, 0, 1]);
    placeCarriedGround(map, held, 2, 1, [1, 0, 0, 1]);
    expect(probe.read()).toHaveLength(4);
    probe.stop();
    placeCarriedGround(map, held, 1, 0, [1, 0, 0, 1]);
    expect(probe.read()).toHaveLength(4);
    expect(probe.read()[2]).toMatchObject({ destination: { elevation: sourceElevation } });
  } finally {
    probe.stop();
    releaseHeldRock(map, held);
  }
});
