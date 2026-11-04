import type { PoiCatalogueEntry, PoiGroupPage, PoiGroupShell } from "./poiTypes";
import { reliefEntries, reliefGroup } from "./groups/relief";
import { waterEntries, waterGroup } from "./groups/water";
import { seaEntries, seaGroup } from "./groups/sea";
import { groundEntries, groundGroup } from "./groups/ground";
import { coverEntries, coverGroup } from "./groups/cover";
import { anomaliesEntries, anomaliesGroup } from "./groups/anomalies";
import { settlementsEntries, settlementsGroup } from "./groups/settlements";

/** The catalogue's group pages, in reading order. */
export const poiGroups: readonly (PoiGroupPage | PoiGroupShell)[] = [
  reliefGroup,
  waterGroup,
  seaGroup,
  groundGroup,
  coverGroup,
  anomaliesGroup,
  settlementsGroup,
];

/** Every catalogue entry, complete or still a shell. */
export const poiCatalogue: readonly PoiCatalogueEntry[] = [
  ...reliefEntries,
  ...waterEntries,
  ...seaEntries,
  ...groundEntries,
  ...coverEntries,
  ...anomaliesEntries,
  ...settlementsEntries,
];
