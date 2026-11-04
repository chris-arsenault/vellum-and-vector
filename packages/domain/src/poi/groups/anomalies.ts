import type { PoiCatalogueEntry, PoiGroupShell } from "../poiTypes";
import { shellsOf } from "../poiShell";

export const anomaliesGroup: PoiGroupShell = {
  status: "shell",
  id: "anomalies",
  name: "Sky and field anomalies",
};

const shell = shellsOf("anomalies");
export const anomaliesEntries: PoiCatalogueEntry[] = [
  shell("auroraField", "Aurora field", "magic"),
  shell("lightWell", "Light well", "magic"),
  shell("compassDeviation", "Compass deviation", "natural", "magic"),
  shell("interferenceLattice", "Interference lattice", "magic"),
  shell("tear", "Tear", "magic"),
  shell("door", "Door", "magic"),
  shell("wildZone", "Wild zone", "magic"),
];
