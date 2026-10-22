import { spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { GenerationState } from "../process";

/** Orders belong to the solved channel geometry. Widths are physical metres. */
export function riverRegion(
  state: GenerationState,
  includes: (order: number) => boolean
): Geometry | null {
  const map = state.physical!.map,
    mesh = map.mesh,
    paths = map.riverPaths;
  if (!paths) {
    if (map.RiverOrders.some((order) => order > 0))
      throw new Error("Prepare channel geometry before reading river regions.");
    return null;
  }
  const reaches: Geometry[] = [];
  for (const [key, profile] of Object.entries(paths.segments)) {
    const i = Number(key),
      j = map.FlowTargets[i];
    if (map.RiverOrders[i] <= 0 || !includes(map.RiverOrders[i])) continue;
    // Profile-only stations lie on an existing chord and retain its linear
    // width. They add no plan geometry and require no additional coverage.
    const stations = profile;
    if (stations.length < 2) continue;
    const reach = spatial.variableBuffer(
      {
        type: "LineString",
        coordinates: stations.map((s) => [
          s.point[0] + mesh.origin[0],
          s.point[1] + mesh.origin[1],
        ]),
      },
      stations.map(
        (s) => (map.RiverWidth[i] * (1 - s.fraction) + map.RiverWidth[j] * s.fraction) / 2
      )
    );
    if (reach) reaches.push(reach);
  }
  if (!reaches.length) return null;
  const shape = spatial.unionAll(reaches);
  const water = [
    state.surface.ocean,
    ...(state.surface.geography?.water?.lakes ?? []).map((lake) => lake.footprint),
  ].filter((body): body is Geometry => Boolean(body));
  return water.length ? spatial.difference(shape, spatial.unionAll(water)) : shape;
}
