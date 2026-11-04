import type { PoiCatalogueEntry, PoiGroupShell } from "../poiTypes";
import { shellsOf } from "../poiShell";

export const waterGroup: PoiGroupShell = { status: "shell", id: "water", name: "Water" };

const shell = shellsOf("water");
export const waterEntries: PoiCatalogueEntry[] = [
  shell("spring", "Spring", "natural", "magic"),
  shell("waterfall", "Waterfall", "natural"),
  shell("lake", "Lake", "natural", "magic", "human"),
  shell("riverMouth", "River mouth", "natural"),
  shell("wetland", "Wetland", "natural"),
  shell("glacier", "Glacier", "natural", "magic"),
  shell("oasis", "Oasis", "natural", "magic"),
];
