import type { PoiCatalogueEntry, PoiGroupShell } from "../poiTypes";
import { shellsOf } from "../poiShell";

export const settlementsGroup: PoiGroupShell = {
  status: "shell",
  id: "settlements",
  name: "Settlements and works",
};

const shell = shellsOf("settlements");
export const settlementsEntries: PoiCatalogueEntry[] = [
  shell("settlement", "Settlement", "human"),
  shell("ruin", "Ruin", "human"),
  shell("dam", "Dam", "human"),
  shell("mill", "Mill", "human"),
  shell("irrigation", "Irrigation", "human"),
  shell("harbour", "Harbour", "human"),
  shell("ford", "Ford", "human"),
  shell("bridge", "Bridge", "human"),
  shell("mine", "Mine", "human"),
  shell("forge", "Forge", "human", "magic"),
  shell("archive", "Archive", "human", "magic"),
  shell("sacredSite", "Sacred site", "human"),
  shell("battlefield", "Battlefield", "human"),
  shell("disasterSite", "Disaster site", "natural", "magic", "human"),
];
