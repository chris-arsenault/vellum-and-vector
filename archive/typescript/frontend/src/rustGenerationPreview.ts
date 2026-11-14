import {
  createGrid,
  detachGrid,
  fieldChannelName,
  generateChannel,
  putChannel,
  type Bounds,
  type GenerationEpoch,
  type SpatialScope,
  type SampleType,
} from "@atlas/domain";

export interface RustPreview {
  ancestry: GenerationEpoch[] | null;
  grid: {
    width: number;
    height: number;
    bounds: Bounds;
    periodicWidth: number | null;
    active: number[];
    channels: Record<
      string,
      {
        dtype: SampleType;
        unit: string;
        quantity: "category" | "intensive" | "extensive";
        values: number[];
      }
    >;
  };
}
/** The existing UI receives only the small display preview, never the execution field. */
export function rustGenerationPreview(input: RustPreview, scope: SpatialScope) {
  const preview = input.grid,
    grid = createGrid("generation-preview", scope, preview.width, preview.height, preview.bounds);
  grid.periodicWidth = preview.periodicWidth ?? undefined;
  preview.active.forEach((active, cell) => grid.active.set(cell, active));
  for (const [key, channel] of Object.entries(preview.channels)) {
    const name = fieldChannelName(key);
    putChannel(
      grid,
      name,
      channel.unit,
      generateChannel(grid, name, (i) => channel.values[i], channel.dtype),
      channel.quantity
    );
  }
  return {
    grid: detachGrid(grid),
    label: input.ancestry?.map((epoch) => epoch.id).join(" / ") ?? "Present geography",
  };
}
