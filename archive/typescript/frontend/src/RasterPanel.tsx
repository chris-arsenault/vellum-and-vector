import type { EditorState } from "./useEditor";
import { resourceRaster, type FieldStyle, type Raster, type World } from "./types";
import { defaultFieldStyle } from "./rasterDefaults";
import { rasterDescription } from "./worldRasterDescription";
import {
  CategoryLegend,
  FieldControls,
  FieldLegend as RasterLegend,
  TerrainControls,
} from "./RasterAppearanceControls";
export { TerrainControls } from "./RasterAppearanceControls";

export function RasterPanel({
  world,
  editor,
  target,
}: {
  world: World;
  editor: EditorState;
  target: string;
}) {
  const channel = target.startsWith("field:") ? target.slice(6) : "";
  if (!channel && !target.startsWith("base:")) return null;
  const field = editor.rasterView.fields.find((field) => field.channel === channel) ?? {
    ...defaultFieldStyle(channel),
    visible: false,
  };
  const update = (changes: Partial<FieldStyle>) =>
    editor.setRasterView((view) => ({
      ...view,
      fields: view.fields.some((item) => item.channel === channel)
        ? view.fields.map((item) => (item.channel === channel ? { ...item, ...changes } : item))
        : [...view.fields, { ...field, ...changes }],
    }));
  return (
    <section className="raster-panel" aria-label="Raster appearance">
      {!channel && (
        <>
          <h3>Terrain appearance</h3>
          <TerrainControls
            view={editor.rasterView}
            update={(changes) => editor.setRasterView((view) => ({ ...view, ...changes }))}
          />
          {editor.rasterView.base === "surface" && (
            <SurfaceLegend world={world} base={editor.baseRaster.data ?? []} />
          )}
        </>
      )}
      {channel && (
        <FieldControls
          key={channel}
          field={field}
          update={update}
          data={rasterDescription(
            world,
            channel,
            (editor.raster.data ?? []).filter((raster) => raster.channel === channel)
          )}
        />
      )}
    </section>
  );
}
export function FieldLegend({
  world,
  field,
  data,
}: {
  world: World;
  field: FieldStyle;
  data: Raster[];
}) {
  return <RasterLegend field={field} data={rasterDescription(world, field.channel, data)} />;
}
export function SurfaceLegend({ world, base }: { world: World; base: Raster[] }) {
  const data = base
    .filter((raster) => raster.surface?.channels.finalSurface)
    .map((raster): Raster =>
      resourceRaster(raster)
        ? { ...raster, field: raster.surface!, channel: "finalSurface" }
        : { ...raster, field: raster.surface!, channel: "finalSurface" }
    );
  return data.length ? (
    <CategoryLegend
      title="Surface"
      classes={rasterDescription(world, "finalSurface", data).categories}
    />
  ) : null;
}
