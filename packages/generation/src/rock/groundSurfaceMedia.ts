import type { PhysicalField } from "../world/field";
import { recordFlow, type FlowCause } from "../coupling/flows";
import { units } from "../world/math";
import { MapScale, type ReadBand } from "@atlas/domain";

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

/** Ice melts by metres; basal melt remains available to the later runoff pass. */
export function meltIce(
  map: PhysicalField,
  i: number,
  amount: number,
  cause: FlowCause,
  beneath = false
) {
  const melted = Math.min(Math.max(0, amount), map.IceThickness.get(i));
  if (melted <= 0) return 0;
  map.IceThickness.set(i, map.IceThickness.get(i) - melted);
  recordFlow(map, cause, "ice", "melt", melted * map.mesh.area(i));
  if (beneath) {
    const water = MapScale.inUnits(melted, "mm");
    map.ExternalMeltwater.add(i, water);
    map.GlacialMeltwater.add(i, water);
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
