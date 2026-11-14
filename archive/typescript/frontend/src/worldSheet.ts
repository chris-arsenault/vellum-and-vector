import { regionLineage } from "@atlas/domain";
import type { DrawnMapInput } from "./drawnMap";
import type { SheetPresentation } from "./sheetPresentation";
import { drawnLegend } from "./drawnLegend";
import { sheetPadding } from "./drawnSheet";

export function worldSheet(input: DrawnMapInput): SheetPresentation {
  return {
    name: input.region?.name ?? input.area.name,
    metresPerUnit: 1,
    ancestry: regionLineage(input.world, input.region?.id ?? null)
      .slice(0, -1)
      .map((region) => region.name),
    view: input.view,
    legend: drawnLegend(input),
  };
}
export function worldSheetPadding(input: DrawnMapInput | undefined, width: number) {
  return sheetPadding(input && worldSheet(input), width);
}
