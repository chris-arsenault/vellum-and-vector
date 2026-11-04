import type { PoiCatalogueEntry, PoiGroupShell } from "../poiTypes";
import { shellsOf } from "../poiShell";

export const groundGroup: PoiGroupShell = {
  status: "shell",
  id: "ground",
  name: "Ground and deposits",
};

const shell = shellsOf("ground");
export const groundEntries: PoiCatalogueEntry[] = [
  shell("thermalVein", "Thermal vein", "magic"),
  shell("placer", "Placer band", "natural", "magic"),
  shell("saltPan", "Salt pan", "natural", "magic"),
  shell("saltDust", "Salt dust", "magic"),
  shell("killingGround", "Killing ground", "magic"),
  shell("basaltFlat", "Basalt flat", "natural", "magic"),
  shell("glassFlat", "Glass flat", "magic"),
  shell("ejectaFan", "Ejecta fan", "natural", "magic"),
  shell("frostPrism", "Frost prism", "magic"),
];
