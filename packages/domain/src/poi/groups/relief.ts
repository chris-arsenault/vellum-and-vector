import type { PoiCatalogueEntry, PoiGroupShell } from "../poiTypes";
import { shellsOf } from "../poiShell";

export const reliefGroup: PoiGroupShell = { status: "shell", id: "relief", name: "Relief" };

const shell = shellsOf("relief");
export const reliefEntries: PoiCatalogueEntry[] = [
  shell("summit", "Summit", "natural", "magic"),
  shell("pass", "Pass", "natural"),
  shell("range", "Mountain range", "natural"),
  shell("escarpment", "Escarpment", "natural"),
  shell("plateau", "Plateau", "natural", "magic"),
  shell("valley", "Valley", "natural"),
  shell("gorge", "Gorge", "natural"),
  shell("volcano", "Volcano", "natural", "magic"),
  shell("caldera", "Caldera", "natural"),
  shell("impactCrater", "Impact crater", "natural", "magic"),
  shell("erodedDome", "Eroded dome", "natural"),
  shell("cirque", "Cirque", "natural"),
  shell("moraine", "Moraine", "natural"),
  shell("sinkholeField", "Sinkhole field", "natural", "magic"),
];
