import { atmosphere, seaFloorZones } from "../processes/climateProcesses";
import { deltaForm, floodplainForm, riverHeat } from "../processes/waterProcesses";
import { readOperation } from "../processOperation";
import type { PhysicalContext } from "./context";
import type { PhysicalField } from "./field";

/** Ecology demands current derived habitat inputs without growing vegetation or moving water. */
export function readEcologyEnvironment(map: PhysicalField, context: PhysicalContext) {
  const input = { map, context };
  for (const owner of [atmosphere, seaFloorZones, riverHeat, floodplainForm, deltaForm])
    readOperation(map, owner.operation, input);
}
