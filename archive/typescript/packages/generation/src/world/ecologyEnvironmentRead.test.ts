import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createMesh } from "./mesh";
import { physicalContext } from "./context";
import { atlasPhysicalProfile } from "./atlasProfile";
import { bindOperation, defineCommand, runOperation } from "../processOperation";
import { atmosphere, seaFloorZones } from "../processes/climateProcesses";
import { deltaForm, floodplainForm, riverHeat } from "../processes/waterProcesses";
import { readEcologyEnvironment } from "./ecologyEnvironmentRead";

it("asks selected habitat owners again after a material command, without running unselected algorithms", () => {
  const map = createTestField(createMesh(4, 0));
  const context = physicalContext(1, 0, atlasPhysicalProfile({}, {}, map.scale));
  const reads: string[] = [];
  for (const owner of [atmosphere, seaFloorZones, riverHeat, floodplainForm, deltaForm])
    bindOperation(map, owner.operation, () => {
      reads.push(owner.id);
    });
  readEcologyEnvironment(map, context);
  expect(reads).toEqual([
    "atmospheric-climate",
    "bathymetry",
    "river-warmth",
    "river-floodplains",
    "river-delta-formation",
  ]);
  reads.length = 0;
  readEcologyEnvironment(map, context);
  expect(reads).toEqual([]);
  runOperation(
    map,
    defineCommand("supplied material change", "event", () => {}, []),
    undefined
  );
  readEcologyEnvironment(map, context);
  expect(reads).toContain("atmospheric-climate");
  expect(reads).toContain("river-warmth");
  expect(reads).toContain("river-delta-formation");
});
