import type { PoiCatalogueEntry, PoiGroupShell } from "../poiTypes";
import { shellsOf } from "../poiShell";

export const seaGroup: PoiGroupShell = { status: "shell", id: "sea", name: "Sea and coast" };

const shell = shellsOf("sea");
export const seaEntries: PoiCatalogueEntry[] = [
  shell("island", "Island", "natural"),
  shell("headland", "Headland", "natural"),
  shell("bay", "Bay", "natural"),
  shell("strait", "Strait", "natural"),
  shell("fjord", "Fjord", "natural"),
  shell("hydrothermalVent", "Hydrothermal vent", "natural", "magic"),
  shell("upwellingFront", "Upwelling front", "natural", "magic"),
  shell("pressureLocus", "Deep pressure locus", "magic"),
  shell("crushZone", "Crush zone", "magic"),
  shell("ancientWake", "Ancient wake", "magic"),
  shell("rogueWaveImpact", "Rogue-wave impact", "magic"),
];
