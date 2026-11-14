import type { PhysicalField } from "../world/field";
import { physicalDistance } from "../world/physicalMetric";
import { reachMonths } from "./reaches";

/** Reaches produce the raster; importing an older raster cannot create a river. */
export function projectRiverOrders(map: PhysicalField) {
  map.RiverOrders.fill(0);
  map.FlowingMonths.fill(0);
  for (const reach of map.rivers.reaches.values()) {
    if (reach.dry || !reach.drawn) continue;
    for (const [at, cell] of reach.cells.entries()) {
      if (map.WaterKindCodes.get(cell) !== 0) continue;
      const flowing = reachMonths(reach, at);
      if (!flowing) continue;
      map.RiverOrders.set(cell, reach.order);
      map.FlowingMonths.set(cell, flowing);
    }
  }
}

/** Below resolved reaches, channel is an aggregate length over the cell's represented area. */
export function projectRivers(map: PhysicalField) {
  projectRiverOrders(map);
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const next = map.FlowTargets.get(cell);
    map.SmallChannelLength.set(
      cell,
      next >= 0 && map.WaterKindCodes.get(cell) === 0 && map.FloodFlow.get(cell) > 0
        ? physicalDistance(map.mesh, cell, next)
        : 0
    );
  }
  for (const reach of map.rivers.reaches.values())
    if (!reach.dry && reach.drawn)
      for (const cell of reach.cells) map.SmallChannelLength.set(cell, 0);
}
