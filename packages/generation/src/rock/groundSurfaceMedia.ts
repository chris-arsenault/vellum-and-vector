import type { PhysicalField } from "../world/field";
import { recordFlow, type FlowCause } from "../coupling/flows";
import { units } from "../world/math";
import { MapScale, type ReadBand } from "@atlas/domain";
import { releasedWaterRate } from "../world/dimensions";
import { receiveMeltwater } from "../water/meltwater";

type MeltReceiver = (cell: number, melted: number, before: number) => void;
// hpc-exempt: one carrier receiver per physical field; inventories remain in their owners.
const meltReceivers = new WeakMap<PhysicalField, MeltReceiver>();
export function receiveIceMelt(map: PhysicalField, receive: MeltReceiver) {
  meltReceivers.set(map, receive);
}

/** A carrier releases only the inventory carried by the fraction that actually melted. */
export function meltedInventory(held: number, melted: number, before: number) {
  return before > 0 ? Math.max(0, held) * Math.min(1, Math.max(0, melted / before)) : 0;
}

/** Formation can add ice; any ablation notifies the existing carrier owners. */
export function setIceResponse(map: PhysicalField, cell: number, next: number, cause: FlowCause) {
  const before = map.IceThickness.get(cell);
  if (next < before) meltIce(map, cell, before - Math.max(0, next), cause);
  else map.IceThickness.set(cell, next);
}

/** A carrier moves an available ice volume; its passenger uses the admitted fraction. */
export function transferIce(map: PhysicalField, from: number, to: number, volume: number) {
  const moved = Math.min(Math.max(0, volume), map.IceThickness.get(from) * map.mesh.area(from));
  map.IceThickness.add(from, -moved / map.mesh.area(from));
  map.IceThickness.add(to, moved / map.mesh.area(to));
  return moved;
}
/** Simultaneous signed volume transfers avoid moving this pass's arrivals a second time. */
export function redistributeIce(map: PhysicalField, volumes: ReadBand) {
  for (let i = 0; i < map.mesh.count; i++)
    map.IceThickness.set(
      i,
      Math.max(0, map.IceThickness.get(i) + volumes.get(i) / map.mesh.area(i))
    );
}

/** Actual metre removals notify carriers; basal runoff retains the producing interval's rate. */
export function meltIce(
  map: PhysicalField,
  i: number,
  amount: number,
  cause: FlowCause,
  beneath = false,
  exposure = 1
) {
  if (!(exposure > 0)) return 0;
  const before = map.IceThickness.get(i),
    melted = Math.min(Math.max(0, amount), before);
  if (melted <= 0) return 0;
  map.IceThickness.set(i, map.IceThickness.get(i) - melted);
  meltReceivers.get(map)?.(i, melted, before);
  recordFlow(map, cause, "ice", "melt", melted * map.mesh.area(i));
  if (beneath) {
    const water = MapScale.inUnits(releasedWaterRate(melted, exposure), "mm");
    receiveMeltwater(map, i, water);
  }
  return melted;
}

/** Soil loses its ecological skin while its substrate remains in the canonical column. */
export function spoilSoil(map: PhysicalField, i: number, share: number, cause: FlowCause) {
  const lost = map.SoilDepth.get(i) * Math.min(1, Math.max(0, share));
  if (lost <= 0) return;
  map.SoilDepth.set(i, map.SoilDepth.get(i) - lost);
  recordFlow(
    map,
    cause,
    "soil",
    "loose",
    MapScale.metres(units(lost), "native") * map.mesh.area(i)
  );
}
