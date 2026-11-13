import { reachAt } from "../water/riverKeeping";
import type { RegionalState } from "./state";

/** During context setup these are the captured reaches imported into this map's own state. */
export const onParentRiver = (state: RegionalState, cell: number) =>
  reachAt(state.physical.map, cell) !== undefined;
