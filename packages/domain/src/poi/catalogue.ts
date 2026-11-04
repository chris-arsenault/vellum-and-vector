import type {
  PoiCatalogueEntry,
  PoiCatalogueRules,
  PoiEntry,
  PoiGroupPage,
  PoiGroupShell,
} from "./poiTypes";
import type { PoiKindId } from "./poiKinds";
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

const complete = (entries: readonly PoiCatalogueEntry[]) =>
  entries.filter((entry): entry is PoiEntry => entry.status !== "shell");

/** Pixels a place needs across before a reader sees it as itself. */
const readablePixels = 8;

/**
 * Catalogue-wide rules.
 *
 * Distinctness: two kinds the catalogue calls exclusive may never claim the same cell; on any
 * map, `conflicts` lists every cell that breaks this, and a sound catalogue returns none.
 *
 * Visibility: a place shows on a view fine enough to read it as itself, spanning at least
 * `readablePixels`. On a coarser view it shows only if it matters enough to be drawn small:
 * one that spans half the readable width needs an importance of at least a half.
 */
export const poiRules: PoiCatalogueRules = {
  conflicts(map) {
    const found = complete(poiCatalogue).map((entry) => ({
      entry,
      cells: new Set(entry.identity.find(map).flatMap((place) => place.cells)),
    }));
    const result: { kinds: [PoiKindId, PoiKindId]; anchor: number }[] = [];
    for (const { entry, cells } of found)
      for (const rule of entry.distinctFrom.filter((d) => d.exclusive)) {
        const other = found.find((f) => f.entry.id === rule.kind);
        for (const cell of other ? cells : [])
          if (other!.cells.has(cell)) result.push({ kinds: [entry.id, rule.kind], anchor: cell });
      }
    return result;
  },
  visibleAt(entry, place, map, metresPerPixel) {
    const legible = entry.visibility.extent(place, map) / (metresPerPixel * readablePixels);
    return legible >= 1 || entry.visibility.importance(place, map) >= 1 - legible;
  },
};
