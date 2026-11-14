import type { PhysicalField } from "../world/field";
import type { ReachStore } from "./reaches";

/** Internal owner capability over the field's existing store; public field views are read-only. */
export const riverStorage = (map: PhysicalField): ReachStore => map.rivers as ReachStore;
