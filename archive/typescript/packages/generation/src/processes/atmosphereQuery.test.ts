import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createMesh } from "../world/mesh";
import { physicalContext } from "../world/context";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { atmosphere } from "./climateProcesses";
import { meltwater, waterTransfer } from "./waterProcesses";
import { bindOperation, defineCommand, readOperation, runOperation } from "../processOperation";

it("temperature and rainfall consumers share the selected completed atmospheric result", () => {
  const map = createTestField(createMesh(4, 0));
  const context = physicalContext(1, 0, atlasPhysicalProfile({}, {}, map.scale));
  const input = { map, context },
    seen: number[][] = [];
  let reads = 0;
  // Explicit strategy output: no climate or water algorithm runs in this contract.
  bindOperation(map, atmosphere.operation, () => {
    reads++;
    map.Temperature.set(0, 427);
    map.Seasonality.set(0, 9);
    map.Rainfall.set(0, 640);
  });
  const recordClimate = () => {
    seen.push([map.Temperature.get(0), map.Seasonality.get(0), map.Rainfall.get(0)]);
  };
  bindOperation(map, meltwater.operation, recordClimate);
  const budgetConsumer = defineCommand(
    "supplied budget consumer",
    "work",
    recordClimate,
    waterTransfer.operation.dependencies
  );
  readOperation(map, meltwater.operation, input);
  runOperation(map, budgetConsumer, input);
  expect(seen).toEqual([
    [427, 9, 640],
    [427, 9, 640],
  ]);
  expect(reads).toBe(1);
  runOperation(
    map,
    defineCommand("changed forcing", "event", () => {}, []),
    undefined
  );
  runOperation(map, budgetConsumer, input);
  expect(reads).toBe(2);
});

it("an omitted atmosphere leaves supplied inherited climate available to a selected consumer", () => {
  const map = createTestField(createMesh(4, 0));
  const context = physicalContext(1, 0, atlasPhysicalProfile({}, {}, map.scale));
  map.Temperature.set(0, 316);
  let read = 0;
  bindOperation(map, meltwater.operation, () => {
    read = map.Temperature.get(0);
  });
  readOperation(map, meltwater.operation, { map, context });
  expect(read).toBe(316);
});
