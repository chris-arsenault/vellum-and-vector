import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import type { MagicInventory } from "./magicInventory";
import { alignedNeighbor } from "./atmosphere";
import { clamp } from "./math";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { redistributeIce } from "../rock/groundSurfaceMedia";

/** Shelf charge rides connected marine ice; open warm water is a loss, not a second carrier. */
export function carryShelf(map: PhysicalField, field: MagicField, stock: MagicInventory) {
  const moved = workingArray(map, "float64", "magic:shelf-current"),
    ice = workingArray(map, "float64", "magic:shelf-ice"),
    p = field.definition.parameters;
  let lost = 0;
  for (let i = 0; i < stock.length; i++) {
    const held = stock.get(i);
    if (held <= 0) continue;
    if (map.WaterKindCodes.get(i) !== 1 || map.IceThickness.get(i) <= 0) {
      stock.set(i, 0);
      lost += held;
      continue;
    }
    const melt =
        held * p.meltwaterLoss * clamp(Math.max(0, map.Temperature.get(i) - 300) / 100, 0, 1),
      target = alignedNeighbor(map, i, map.OceanCurrentX.get(i), map.OceanCurrentY.get(i)),
      share =
        target >= 0 && map.WaterKindCodes.get(target) === 1
          ? (held - melt) * p.iceCarry * clamp(map.OceanCurrentStrength.get(i) / 1000, 0, 1)
          : 0;
    stock.set(i, held - melt - share);
    lost += melt;
    const volume = map.IceThickness.get(i) * map.mesh.area(i),
      carriedIce = (volume * share) / held;
    ice.add(i, (-volume * (melt + share)) / held);
    if (share > 0) {
      moved.add(target, share);
      ice.add(target, carriedIce);
    }
  }
  for (let i = 0; i < stock.length; i++) {
    stock.add(i, moved.get(i));
  }
  redistributeIce(map, ice);
  releaseWorking(map, moved, ice);
  field.lost += lost;
}
