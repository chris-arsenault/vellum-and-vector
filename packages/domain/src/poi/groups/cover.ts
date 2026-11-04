import type { PoiCatalogueEntry, PoiGroupShell } from "../poiTypes";
import { shellsOf } from "../poiShell";

export const coverGroup: PoiGroupShell = { status: "shell", id: "cover", name: "Living cover" };

const shell = shellsOf("cover");
export const coverEntries: PoiCatalogueEntry[] = [
  shell("forest", "Forest", "natural", "magic"),
  shell("grassland", "Grassland", "natural", "magic"),
  shell("desert", "Desert", "natural", "magic"),
  shell("thawedHalo", "Thawed halo", "magic"),
  shell("clearance", "Clearance", "human"),
];
