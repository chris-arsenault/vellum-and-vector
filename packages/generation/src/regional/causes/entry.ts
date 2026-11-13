import { registerCause } from "./registry";
import { flowThroughYear } from "../../water/waterBalance";

/** Boundary crossings belong to captured reaches, including their upstream catchment. */
registerCause({
  kind: "river-entry",
  read(state, evidence) {
    for (const entry of state.physical.map.rivers.entries)
      evidence.entries.push({
        cell: entry.cell,
        discharge: flowThroughYear(entry.monthly, 0).mean,
        catchment: entry.catchment,
      });
  },
});
