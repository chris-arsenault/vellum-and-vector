import { fieldChannelName, physicalMaterialNames } from "@atlas/domain";
import type { Raster, World } from "./types";
import {
  categoryPalette,
  defaultFieldStyle,
  fieldLabel,
  fieldRange,
  rasterCategories,
} from "./rasterPresentation";
import { shownUnit } from "./fieldNames";
import type { RasterDescription } from "./RasterAppearanceControls";

export function rasterDescription(
  world: World,
  channel: string,
  data: Raster[]
): RasterDescription {
  const present = new Set(rasterCategories(data));
  return {
    name: fieldLabel(world, channel),
    channel,
    display: shownUnit(data[0]?.field.units[fieldChannelName(channel)] ?? ""),
    range: fieldRange(data, defaultFieldStyle(channel)),
    categories:
      channel === "PhysicalMaterial"
        ? physicalMaterialNames.map((label, value) => ({
            value,
            label,
            color: null,
            present: present.has(value),
            surface: null,
          }))
        : (categoryPalette(world, channel) ?? []).map((category) => ({
            value: category.code,
            label: category.name,
            color: category.color,
            present: present.has(category.code),
            surface: null,
          })),
  };
}
