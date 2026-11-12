import { ask } from "../coupling/answers";
import type { MapProcessContext } from "../process";
import { nativeContext } from "../world/context";
import { isContent } from "./lattice";
import type { RegionalState } from "./state";

/**
 * What the map's dry land is like for whoever lives on it, as one line: the share of the map
 * that is dry, and over that dry land the means of what its yields are made from. It is read
 * out each round so a change in what the land feeds can be traced to what changed in the land.
 */
export function landReadout(state: RegionalState, context: MapProcessContext) {
  const map = state.physical.map,
    season = ask(map, "season", nativeContext(state, context, 0)),
    sums = { season: 0, soil: 0, moisture: 0, slope: 0, trees: 0, grass: 0, river: 0 };
  let land = 0,
    all = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (!isContent(map.mesh, cell)) continue;
    const area = map.mesh.area(cell);
    all += area;
    if (map.WaterKindCodes.get(cell) !== 0) continue;
    land += area;
    sums.season += season.get(cell) * area;
    sums.soil += map.SoilDepth.get(cell) * area;
    sums.moisture += (map.Moisture.get(cell) / 1000) * area;
    sums.slope += map.Slope.get(cell) * area;
    sums.trees += map.TreeCover.get(cell) * area;
    sums.grass += map.GrassCover.get(cell) * area;
    sums.river += (map.RiverOrders.get(cell) > 0 ? 1 : 0) * area;
  }
  const mean = (value: number) => (land > 0 ? value / land : 0).toFixed(3);
  return (
    `dry land ${(all > 0 ? (100 * land) / all : 0).toFixed(1)}% of the map; over it: ` +
    `growing season ${mean(sums.season)}, soil ${mean(sums.soil)} m, moisture ${mean(sums.moisture)}, ` +
    `slope ${mean(sums.slope)}, tree cover ${mean(sums.trees)}, grass ${mean(sums.grass)}, ` +
    `on a river ${mean(sums.river)}`
  );
}
