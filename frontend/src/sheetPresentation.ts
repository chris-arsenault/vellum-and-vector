import type { CartographicPresentation } from "./types";
import type { DrawnLegendEntry } from "./cartographicLegend";

/** Finished cartographic content; the sheet knows nothing about generating the map. */
export interface SheetPresentation {
  name: string;
  metresPerUnit: number;
  ancestry: string[];
  view: CartographicPresentation;
  legend: DrawnLegendEntry[];
}
