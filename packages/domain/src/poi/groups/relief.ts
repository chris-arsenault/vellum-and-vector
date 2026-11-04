import type { PoiCatalogueEntry, PoiGroupPage } from "../poiTypes";
import { shellsOf } from "../poiShell";
import { summit } from "../relief/summit";

export const reliefGroup: PoiGroupPage = {
  status: "drafted",
  id: "relief",
  name: "Relief",
  belongs:
    "The shape of the ground itself: high points, the cols between them, slopes, corridors and hollows, made by uplift, volcanism, impact, erosion, ice or magic, whatever rock they are cut in.",
  excludes:
    "What lies on the surface rather than shaping it (deposits under Ground and deposits, vegetation under Living cover), water held in the hollows (Water) and forms where land meets sea (Sea and coast).",
};

const shell = shellsOf("relief");
export const reliefEntries: PoiCatalogueEntry[] = [
  summit as PoiCatalogueEntry,
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
