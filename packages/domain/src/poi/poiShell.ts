import type { PoiGroupId, poiKindIds } from "./poiKinds";
import type { PoiOrigin, PoiShell } from "./poiTypes";

/** Shells of one group: a kind not in that group's id list does not compile. */
export const shellsOf =
  <G extends PoiGroupId>(group: G) =>
  (id: (typeof poiKindIds)[G][number], name: string, ...origins: PoiOrigin[]): PoiShell => ({
    status: "shell",
    id,
    group,
    name,
    origins,
  });
