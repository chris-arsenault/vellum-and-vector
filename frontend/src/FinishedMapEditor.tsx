import { useState } from "react";
import type {
  Inspection,
  MapDescriptor,
  MapRef,
  MapRegion,
  RegionSelection,
  SavedMapDocument,
} from "@atlas/map";
import { FinishedSave } from "./FinishedSave";
import type { AtlasContext } from "@atlas/context";
import { Brand } from "./Brand";
import { PublishedMapCanvas } from "./PublishedMapCanvas";
import { PublishedAppearance } from "./PublishedAppearance";
import { PublishedLayerPanel } from "./PublishedLayerPanel";
import { PublishedSheetPanel } from "./PublishedSheetPanel";
import { PublishedCellInspection } from "./PublishedCellInspection";
import { PublishedRegistry } from "./PublishedRegistry";
import { PublishedFeatureInformation } from "./PublishedFeatureInformation";
import { PublishedRegionsPanel } from "./PublishedRegionsPanel";
import { PublishedMapViews } from "./PublishedMapViews";
import { usePublishedNavigation } from "./usePublishedNavigation";
import { usePublishedRegions, usePublishedRegionPresentation } from "./usePublishedRegions";
import { initialPublishedPresentation } from "./publishedStyling";
import { publishedFeature, type PublishedFeature } from "./publishedAppearance";
import { FinishedHistory, RelatedMaps } from "./FinishedMapPanels";
import type { PublishedTool } from "./publishedInteractions";
import type { PublishedPresentation } from "./PublishedMapView";
import { ErrorMessage } from "./ErrorMessage";
import { download } from "./download";
import { RealScaleControls } from "./RealScaleControls";
import { RealScaleOpen } from "./RealScaleOpen";
import { defaultRealScalePresentation, shownSpace } from "./realScale";
import { RealScaleEditor } from "./RealScaleEditor";
import { StructureProvider, useStructureServices } from "./structureServices";
import { useRealScaleAuthoring, type AuthoringSession } from "./useRealScaleAuthoring";
import type { RealScaleChoice } from "@atlas/context";
import "./mapSettings.css";

interface Props {
  context: Pick<AtlasContext<unknown>, "maps" | "library" | "navigation" | "editing" | "mode">;
  map: MapDescriptor;
  saved?: SavedMapDocument;
  open(reference: MapRef): void;
  create(): void;
  lore(): void;
  library(): void;
  refine(
    selection: RegionSelection,
    name: string,
    child?: MapRef,
    realScale?: RealScaleChoice
  ): void;
  regenerate(): void;
}
// owner-direction(2026-11-14): presentation reads only GIS map storage, never numerical generation storage.
function useFinishedMap(props: Props) {
  const { map, context } = props;
  const [appearance, change] = useState(
    () =>
      (props.saved?.reference.revision === map.reference.revision
        ? (props.saved.settings.presentation as unknown as PublishedPresentation)
        : undefined) ?? initialPublishedPresentation(map)
  );
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [selected, select] = useState<PublishedFeature | null>(null);
  const [tool, setRegionTool] = useState<PublishedTool>("inspect");
  const [panel, showPanel] = useState("regions");
  const navigation = usePublishedNavigation(map, context.navigation);
  const regions = usePublishedRegions({
    map,
    reader: context.maps,
    navigation: context.navigation,
    saved: navigation,
    tool,
    setTool: setRegionTool,
    enterMap: props.open,
    initialRegionId: appearance.ancestry.at(-1),
  });
  const { setTool, setPanel } = regionScoped(tool, regions, setRegionTool, showPanel);
  const value = usePublishedRegionPresentation(appearance, regions);
  const outline = regions.draft?.candidate.geometry ?? regions.region?.geometry;
  const selection: RegionSelection | null = outline
    ? {
        parent: map.reference,
        spaceId: map.primarySpaceId,
        geometry: outline,
        featureIds: [],
        regionPath: [],
      }
    : null;
  const [error, setError] = useState<unknown>(null);
  const inspect = (next: Inspection) => {
    setInspection(next);
    select(next.features[0] ? publishedFeature(next.features[0]) : null);
  };
  const refine = (region: MapRegion) =>
    props.refine(regionSelection(map, region, regions), region.name, region.child ?? undefined);
  return {
    props,
    map,
    context,
    value,
    change,
    inspection,
    setInspection,
    selected,
    select,
    tool,
    setTool,
    panel,
    setPanel,
    navigation,
    regions,
    selection,
    error,
    setError,
    inspect,
    refine,
  };
}
/**
 * An unfinished region outline belongs to the region tools in the regions panel: choosing
 * another tool discards it, and leaving the panel ends region selection.
 */
function regionScoped(
  tool: PublishedTool,
  regions: ReturnType<typeof usePublishedRegions>,
  setTool: (tool: PublishedTool) => void,
  showPanel: (panel: string) => void
) {
  return {
    setTool: (next: PublishedTool) => {
      if (!next.startsWith("region-")) regions.discard();
      setTool(next);
    },
    setPanel: (next: string) => {
      if (next !== "regions" && tool.startsWith("region-")) regions.cancel();
      else if (next !== "regions") regions.discard();
      showPanel(next);
    },
  };
}
function regionSelection(
  map: MapDescriptor,
  region: MapRegion,
  regions: ReturnType<typeof usePublishedRegions>
): RegionSelection {
  return {
    parent: map.reference,
    spaceId: region.spaceId,
    geometry: region.geometry,
    featureIds: [],
    regionPath: regions.ancestry.map((id) => regions.regions.find((region) => region.id === id)!),
  };
}
type Model = ReturnType<typeof useFinishedMap>;
export function FinishedMapEditor(props: Props) {
  const model = useFinishedMap(props);
  const authoring = useRealScaleAuthoring(props.map, props.context.editing, (space) =>
    model.change((value) => ({
      ...value,
      realScale: { ...(value.realScale ?? defaultRealScalePresentation()), space },
    }))
  );
  const editing = model.tool === "edit" && !!props.map.realScale;
  const structure = useStructureServices(props, authoring);
  return (
    <StructureProvider value={structure}>
      <div className="app-shell finished-atlas">
        <FinishedHeader model={model} />
        <FinishedCanvas model={model} authoring={authoring} />
        {model.panel && <FinishedControls model={model} />}
        {editing ? (
          <RealScaleEditor
            session={authoring}
            reader={props.context.maps}
            units={model.value.realScale?.units ?? "metres"}
          />
        ) : (
          (model.inspection || model.selected) && <FinishedInspection model={model} />
        )}
      </div>
    </StructureProvider>
  );
}
function FinishedHeader({ model }: { model: Model }) {
  const { props, map, context, value, navigation, setError, panel, setPanel } = model;
  return (
    <>
      {" "}
      <header className="app-header">
        <Brand />
        <strong>{map.name}</strong>
        <button onClick={props.create}>+ New world</button>
        <button
          onClick={props.regenerate}
          disabled={map.state !== "complete" || !!map.realScale?.edits}
          title={map.realScale?.edits ? "Edited by hand; regenerating would replace it" : undefined}
        >
          Regenerate map
        </button>
        <FinishedSave
          {...props}
          value={value}
          navigation={navigation.state}
          edits={map.realScale?.edits ?? 0}
        />
        <button onClick={props.library}>
          {context.mode === "backend" ? "Server maps" : "Saved maps"}
        </button>
        <button onClick={props.lore}>Lore</button>
        <button
          onClick={() =>
            void context.maps
              .export(map.reference, "geojson")
              .then(
                (asset) =>
                  download(
                    `${map.name}.geojson`,
                    new Blob([new Uint8Array(asset.bytes)], { type: asset.mediaType })
                  ),
                setError
              )
          }
        >
          Export GIS
        </button>
      </header>
      <nav className="map-navigation" aria-label="Workspace panels">
        {["regions", "appearance", "layers", "views", "registry", "history"].map((id) => (
          <button
            key={id}
            aria-expanded={panel === id}
            onClick={() => setPanel(panel === id ? "" : id)}
          >
            {id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </nav>
    </>
  );
}
function FinishedCanvas({ model, authoring }: { model: Model; authoring: AuthoringSession }) {
  const { props, map, context, value, tool, setTool, selection, inspect, regions, error } = model;
  return (
    <main className="map-workspace">
      <RelatedMaps {...props} />
      <nav aria-label="Map tools">
        {mapTools(map).map((id) => (
          <button key={id} aria-pressed={tool === id} onClick={() => setTool(id)}>
            {toolNames[id]}
          </button>
        ))}
      </nav>
      <PublishedMapCanvas
        map={map}
        reader={context.maps}
        spaceId={shownSpace(map, value.realScale)}
        presentation={value}
        tool={tool}
        selection={selection}
        onInspection={inspect}
        regionEvents={regions}
        onEngine={() => {}}
        authoring={map.realScale ? authoring : undefined}
      />
      <ErrorMessage error={error} />
    </main>
  );
}
const mapTools = (map: MapDescriptor): PublishedTool[] => [
  "pan",
  "inspect",
  "inspect-cell",
  ...(map.realScale ? (["measure", "edit"] as const) : []),
];
const toolNames: Record<string, string> = {
  pan: "Pan",
  inspect: "Inspect feature",
  "inspect-cell": "Inspect place",
  measure: "Measure",
  edit: "Edit map",
};
function FinishedControls({ model }: { model: Model }) {
  const {
    map,
    context,
    value,
    change,
    navigation,
    regions,
    tool,
    setTool,
    panel,
    setPanel,
    selected,
    select,
    refine,
  } = model;
  return (
    <aside className="map-drawer" id="map-drawer" aria-label="Map controls">
      <button onClick={() => setPanel("")}>Close panel</button>
      {panel === "regions" && (
        <PublishedRegionsPanel
          map={map}
          regions={regions}
          saved={navigation}
          tool={tool}
          setTool={setTool}
          refine={refine}
        />
      )}
      {panel === "appearance" && (
        <>
          <RealScaleControls map={map} reader={context.maps} value={value} change={change} />
          <PublishedAppearance map={map} reader={context.maps} value={value} change={change} />
          {value.drawing.mode === "drawn" && (
            <PublishedSheetPanel map={map} reader={context.maps} value={value} change={change} />
          )}
        </>
      )}
      {panel === "layers" && (
        <PublishedLayerPanel map={map} reader={context.maps} value={value} change={change} />
      )}
      {panel === "views" && (
        <PublishedMapViews
          map={map}
          saved={navigation}
          regionId={regions.id}
          value={value}
          open={(view, presentation) => {
            regions.select(view.regionId);
            change(presentation);
          }}
        />
      )}
      {panel === "registry" && (
        <PublishedRegistry
          map={map}
          reader={context.maps}
          selected={selected?.id ?? null}
          open={(row) => select(publishedFeature(row.feature))}
          hidden={(row) =>
            value.styles.some((style) => style.layerId === row.feature.layerId && !style.visible)
          }
        />
      )}
      {panel === "history" && <FinishedHistory context={context} map={map} />}
    </aside>
  );
}
function FinishedInspection({ model }: { model: Model }) {
  const { props, map, context, inspection, setInspection, selected, select, setPanel, regions } =
    model;
  return (
    <aside className="right-panel selection-sidebar">
      <button
        onClick={() => {
          setInspection(null);
          select(null);
        }}
      >
        Close inspection
      </button>
      <PublishedCellInspection map={map} inspection={inspection} />
      {inspection && map.state === "complete" && (
        <RealScaleOpen
          map={map}
          inspection={inspection}
          open={(selection, choice, name) => props.refine(selection, name, undefined, choice)}
        />
      )}
      {selected && (
        <PublishedFeatureInformation
          map={map}
          reader={context.maps}
          feature={selected}
          select={select}
          region={(geometry) => {
            setPanel("regions");
            if (geometry)
              void regions.draw(geometry as import("@atlas/map").Geometry, map.bounds, 0);
            else regions.begin();
          }}
        />
      )}
    </aside>
  );
}
