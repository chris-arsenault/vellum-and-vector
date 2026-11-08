import type { PhysicalField } from "../world/field";
import { recordFlow, type FlowCause } from "../coupling/flows";
import { units } from "../world/math";
import { MapScale } from "@atlas/domain";

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
  if (beneath) map.GlacialMeltwater.add(i, MapScale.inUnits(melted, "mm"));
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
