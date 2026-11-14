import { useEffect, useState } from "react";
import type {
  Inspection,
  MapDescriptor,
  MapReader,
  MapNavigation,
  RegionSelection,
} from "@atlas/map";
import { usePublishedNavigation } from "../src/usePublishedNavigation";
import { usePublishedRegions, usePublishedRegionPresentation } from "../src/usePublishedRegions";
import { PublishedRegionsPanel } from "../src/PublishedRegionsPanel";
import { PublishedMapViews } from "../src/PublishedMapViews";
import type { PublishedTool } from "../src/publishedInteractions";
import { PublishedMapCanvas } from "../src/PublishedMapCanvas";
import { PublishedAppearance } from "../src/PublishedAppearance";
import { PublishedLayerPanel } from "../src/PublishedLayerPanel";
import { PublishedSheetPanel } from "../src/PublishedSheetPanel";
import { PublishedCellInspection } from "../src/PublishedCellInspection";
import { PublishedRegistry } from "../src/PublishedRegistry";
import { PublishedFeatureInformation } from "../src/PublishedFeatureInformation";
import { publishedFeature, type PublishedFeature } from "../src/publishedAppearance";
import { initialPublishedPresentation } from "../src/publishedStyling";
import type { PublishedMapEngine } from "../src/publishedMapEngine";
import "../src/mapSettings.css";
import "./publishedMapUi.css";

interface Props {
  map: MapDescriptor;
  reader: MapReader;
  navigation: MapNavigation;
}
/** The same controls and controller consume the supplied map through its real reader. */
export function PublishedMapUi({ map, reader, navigation }: Props) {
  const [appearance, change] = useState(() => initialPublishedPresentation(map));
  const [engine, setEngine] = useState<PublishedMapEngine | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const pixels = usePixels(engine);
  const [error, setError] = useState("");
  const [tool, setTool] = useState<PublishedTool>("inspect-cell");
  const saved = usePublishedNavigation(map, navigation);
  const regions = usePublishedRegions({
    map,
    reader,
    navigation,
    saved,
    tool,
    setTool,
    enterMap: () => setError("Unexpected map navigation"),
  });
  const outline = regions.draft?.candidate.geometry ?? regions.region?.geometry;
  const value = usePublishedRegionPresentation(appearance, regions);
  const selection = selectedOutline(map, outline);
  return (
    <section aria-label="Published map controls" className="published-fixture">
      <div className="published-fixture-map">
        <PublishedMapCanvas
          map={map}
          reader={reader}
          spaceId={map.primarySpaceId}
          presentation={value}
          tool={tool}
          selection={selection}
          onInspection={setInspection}
          regionEvents={regions}
          onEngine={setEngine}
        />
      </div>
      <div className="published-fixture-controls">
        <PublishedAppearance map={map} reader={reader} value={value} change={change} />
        <PublishedLayerPanel map={map} reader={reader} value={value} change={change} />
        {value.drawing.mode === "drawn" && (
          <PublishedSheetPanel map={map} reader={reader} value={value} change={change} />
        )}
      </div>
      <output aria-label="Rendered controls map">{pixels}</output>
      <output aria-label="Clicked map facts">{JSON.stringify(inspection)}</output>
      <PublishedCellInspection map={map} inspection={inspection} />
      <PublishedRegionsPanel
        map={map}
        regions={regions}
        saved={saved}
        tool={tool}
        setTool={setTool}
        refine={() => setError("Unexpected refinement")}
      />
      <PublishedMapViews
        map={map}
        saved={saved}
        regionId={regions.id}
        value={value}
        open={(view, presentation) => {
          regions.select(view.regionId);
          change(presentation);
        }}
      />
      <FeatureInspection map={map} reader={reader} error={setError} />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function selectedOutline(map: MapDescriptor, outline?: RegionSelection["geometry"]) {
  return outline
    ? {
        parent: map.reference,
        spaceId: map.primarySpaceId,
        geometry: outline,
        featureIds: [],
        regionPath: [],
      }
    : null;
}
function FeatureInspection({
  map,
  reader,
  error,
}: {
  map: MapDescriptor;
  reader: MapReader;
  error(value: string): void;
}) {
  const [selected, setSelected] = useState<PublishedFeature | null>(null);
  return (
    <>
      <PublishedRegistry
        map={map}
        reader={reader}
        selected={selected?.id ?? null}
        open={(row) => setSelected(publishedFeature(row.feature))}
        hidden={() => false}
      />
      {selected && (
        <PublishedFeatureInformation
          map={map}
          reader={reader}
          feature={selected}
          select={setSelected}
          region={() => error("Unexpected region")}
        />
      )}
    </>
  );
}
function usePixels(engine: PublishedMapEngine | null) {
  const [pixels, setPixels] = useState("");
  useEffect(() => {
    if (!engine) return;
    const observed = new Set<unknown>();
    const listen = () => {
      for (const [id, layer] of engine.rasters.layers) {
        if (observed.has(layer)) continue;
        observed.add(layer);
        layer.on("postrender", (event) => {
          const gl = event.context as WebGLRenderingContext,
            data = new Uint8Array(4);
          gl.readPixels(
            gl.drawingBufferWidth / 2,
            gl.drawingBufferHeight / 2,
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            data
          );
          if (data[3]) setPixels(JSON.stringify({ id, pixels: [...data] }));
        });
      }
    };
    engine.map.on("precompose", listen);
    return () => engine.map.un("precompose", listen);
  }, [engine]);
  return pixels;
}
