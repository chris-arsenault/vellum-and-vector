import { expect, it } from "vitest";
import { putChannel, residentBand } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "./worldMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { bindOperation, defineCommand, runOperation } from "../processOperation";
import { currents, oceanRead } from "../processes/climateProcesses";
import { ask } from "../coupling/answers";
import { bindCoastalForcing } from "./coastalForcing";

function supplied() {
  const state = landscape(),
    map = createTestField(createWorldMesh([0, 0, 4000, 1000], 16, 0)),
    profile = atlasPhysicalProfile({}, {}, map.scale);
  state.physical = {
    map,
    profile,
    grid: state.surface.coverage,
    samples: residentBand("int32", new Int32Array(state.surface.active.length)),
    fixed: [],
    inherited: false,
  };
  const pressure = residentBand("float64", new Float64Array(state.surface.active.length).fill(0.4));
  putChannel(state.surface, "CoastalPressure", "ratio", pressure);
  bindCoastalForcing(state);
  return { state, map, context: physicalContext(1, 0, profile), pressure };
}

it("replaces received forcing after its ocean dependency changes the supplied shoreline", () => {
  const { map, context } = supplied(),
    reads: string[] = [],
    first = 0,
    next = map.mesh.neighbor(first, 0);
  expect(next).toBeGreaterThanOrEqual(0);
  let shore = first;
  bindOperation(map, oceanRead.operation, () => {
    reads.push("ocean");
    map.WaterKindCodes.fill(1);
    map.WaterKindCodes.set(shore, 0);
  });
  bindOperation(map, currents.operation, () => {
    reads.push("currents");
  });
  expect(ask(map, "coastalForcing", context).get(first)).toBe(400);
  expect(reads).toEqual(["ocean", "currents"]);
  runOperation(
    map,
    defineCommand(
      "supplied shoreline replacement",
      "event",
      () => {
        shore = next;
      },
      []
    ),
    undefined
  );
  const received = ask(map, "coastalForcing", context);
  expect(received.get(first)).toBe(0);
  expect(received.get(next)).toBe(400);
  expect(reads).toEqual(["ocean", "currents", "ocean", "currents"]);
  expect(map.ExternalCoastalForcingHistory.get(next)).toBe(0);
});

it("removes ended standalone forcing without requiring any configured magic", () => {
  const { map, context, pressure } = supplied();
  map.WaterKindCodes.fill(1);
  map.WaterKindCodes.set(0, 0);
  expect(ask(map, "coastalForcing", context).get(0)).toBe(400);
  runOperation(
    map,
    defineCommand(
      "supplied source cessation",
      "event",
      () => {
        pressure.fill(0);
      },
      []
    ),
    undefined
  );
  expect(ask(map, "coastalForcing", context).get(0)).toBe(0);
});
