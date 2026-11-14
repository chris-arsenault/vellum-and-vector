import { useRef } from "react";
import { MapAppearanceControls } from "./MapAppearanceControls";
import { BaseMapChoices } from "./BaseMapChoices";
import { TerrainControls, CategoryLegend } from "./RasterAppearanceControls";
import { changePublishedDrawing, type PublishedStyleContext } from "./publishedStyling";

export function PublishedAppearance(context: PublishedStyleContext) {
  return (
    <MapAppearanceControls
      value={context.value.drawing}
      update={(changes) => changePublishedDrawing(context, changes)}
      raster={<PublishedTerrain context={context} />}
    />
  );
}
export function PublishedTerrain({ context }: { context: PublishedStyleContext }) {
  const terrain = useRef<HTMLDetailsElement>(null);
  const { map, value, change } = context;
  const source = map.layers.find((layer) => layer.id === "terrain")?.source;
  const categories =
    source?.kind === "raster"
      ? (source.data.bands.find((band) => band.id === "surface")?.categories ?? [])
      : [];
  return (
    <div className="raster-appearance">
      <BaseMapChoices
        view={value.raster}
        change={(base) => change({ ...value, raster: { ...value.raster, base } })}
        edit={() => {
          if (terrain.current) {
            terrain.current.open = !terrain.current.open;
            terrain.current.querySelector("input")?.focus();
          }
        }}
      />
      <details className="map-control-group" ref={terrain}>
        <summary>Terrain appearance</summary>
        <TerrainControls
          view={value.raster}
          update={(changes) => change({ ...value, raster: { ...value.raster, ...changes } })}
        />
        {value.raster.base === "surface" && <CategoryLegend title="Surface" classes={categories} />}
      </details>
    </div>
  );
}
