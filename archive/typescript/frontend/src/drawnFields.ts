import { fieldInterpolator, fieldChannelName, spatial } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { LoadedDrawnMapInput as DrawnMapInput } from "./drawnMap";
import { lineage } from "./presentation";
import type { World } from "./types";
import type { CartographicPresentation } from "@atlas/domain";
import { rasterLimits } from "./rasterTiles";
import { depictFields, socialFieldChannel } from "./fieldDepiction";
export { fieldMarksAcrossSubject, socialFieldChannel } from "./fieldDepiction";
export type { FieldMark } from "./fieldDepiction";
export { illustratedFields } from "./illustratedFields";

export function initialSubjectFields(view: CartographicPresentation, world: World, areaId: string) {
  if (view.subject !== "cultural" || view.fields.length) return view;
  const ancestors = new Set(lineage(world, areaId).map((area) => area.id));
  const channels = world.fields
    .filter((field) => ancestors.has(field.areaId))
    .flatMap((field) => field.channels ?? []);
  for (const prefix of ["culture:", "languageUse:", "religion:"]) {
    const channel = channels.find((entry) => entry.startsWith(prefix));
    if (channel) return { ...view, fields: [channel] };
  }
  return view;
}
export function fieldMarks(input: DrawnMapInput, footprint: Geometry) {
  const fields = input.view.fields.map((channel) => {
    const parts = input.rasters
      .filter((raster) => raster.channel === channel)
      .slice()
      .reverse();
    return {
      channel,
      maximum:
        socialFieldChannel.test(channel) && channel.includes(":")
          ? 1
          : Math.max(1, rasterLimits(parts)[1]),
      samplers: parts.map((raster) => ({
        covers: spatial.pointCoverage(raster.footprint),
        at: fieldInterpolator(raster.field, fieldChannelName(channel)),
      })),
    };
  });
  return depictFields(fields, footprint);
}
