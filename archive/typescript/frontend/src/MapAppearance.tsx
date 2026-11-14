import { useRef } from "react";
import type { EditorState } from "./useEditor";
import { BaseChoices } from "./LayerBrowser";
import { TerrainControls, SurfaceLegend } from "./RasterPanel";
import { RenderingReadout } from "./RenderingReadout";
import { MapAppearanceControls } from "./MapAppearanceControls";

export function MapAppearance({ editor }: { editor: EditorState }) {
  return (
    <MapAppearanceControls
      value={editor.cartography}
      update={(change) => editor.setCartography({ ...editor.cartography, ...change })}
      raster={<RasterAppearance editor={editor} />}
    />
  );
}
function RasterAppearance({ editor }: { editor: EditorState }) {
  const terrain = useRef<HTMLDetailsElement>(null);
  const openTerrain = () => {
    if (!terrain.current) return;
    terrain.current.open = !terrain.current.open;
    if (terrain.current.open) terrain.current.querySelector<HTMLInputElement>("input")?.focus();
  };
  return (
    <div className="raster-appearance">
      <BaseChoices editor={editor} edit={openTerrain} />
      <details className="map-control-group" ref={terrain}>
        <summary>Terrain appearance</summary>
        <TerrainControls
          view={editor.rasterView}
          update={(change) => editor.setRasterView((view) => ({ ...view, ...change }))}
        />
        {editor.rasterView.base === "surface" && (
          <SurfaceLegend world={editor.world} base={editor.baseRaster.data ?? []} />
        )}
      </details>
      <RenderingReadout />
    </div>
  );
}
