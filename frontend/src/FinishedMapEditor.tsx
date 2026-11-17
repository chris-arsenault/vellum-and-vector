import { useEffect, useState } from "react";
import type {
  Inspection,
  MapDescriptor,
  MapRef,
  MapRegion,
  RegionSelection,
  SavedMapDocument,
} from "@atlas/map";
import { FinishedMapBar } from "./FinishedMapBar";
import { PublishedSelectionToolbar } from "./PublishedSelectionToolbar";
import { MapSelectionMenu } from "./MapSelectionMenu";
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
import { RealScaleControls } from "./RealScaleControls";
import { RealScaleOpen } from "./RealScaleOpen";
import { defaultRealScalePresentation, shownSpace } from "./realScale";
import { RealScaleEditor } from "./RealScaleEditor";
import { StructureProvider, useStructureServices } from "./structureServices";
import { useRealScaleAuthoring, type AuthoringSession } from "./useRealScaleAuthoring";
import type { RealScaleChoice } from "@atlas/context";
import "./mapSettings.css";
import "./finishedWorkspace.css";

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
    setTool: setRegionTool,
    initialRegionId: appearance.ancestry.at(-1),
  });
  const clear = () => {
    regions.select(null);
    setInspection(null);
    select(null);
  };
  const setTool = (next: PublishedTool) => {
    if (next !== "pan") clear();
    setRegionTool(next);
  };
  const setPanel = showPanel;
  const value = usePublishedRegionPresentation(appearance, regions);
  const selection = finishedSelection(map, regions, selected);
  const [error, setError] = useState<unknown>(null);
  const inspect = (next: Inspection) => {
    regions.select(null);
    setInspection(next);
    select(next.features[0] ? publishedFeature(next.features[0]) : null);
  };
  const refine = (region: MapRegion) =>
    props.refine(regionSelection(map, region, regions), region.name, region.child ?? undefined);
  return {
    ...{ props, map, context, value, change, inspection, setInspection, selected, select },
    ...{ tool, setTool },
    ...{
      panel,
      setPanel,
      navigation,
      regions,
      selection,
      error,
      setError,
      inspect,
      refine,
      clear,
    },
    refineSelection: (name?: string) => {
      if (regions.region && !regions.draft) return refine(regions.region);
      if (selection)
        props.refine(
          selection,
          name?.trim() || regions.draft?.candidate.name || selected?.name || "Region"
        );
    },
  };
}
function featureOutline(feature: PublishedFeature | null): RegionSelection["geometry"] | null {
  const geometry = feature?.footprint ?? feature?.geometry;
  return geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
    ? (geometry as RegionSelection["geometry"])
    : null;
}
function finishedSelection(
  map: MapDescriptor,
  regions: ReturnType<typeof usePublishedRegions>,
  selected: PublishedFeature | null
): RegionSelection | null {
  const geometry =
    regions.draft?.candidate.geometry ?? regions.region?.geometry ?? featureOutline(selected);
  return geometry
    ? {
        parent: map.reference,
        spaceId: map.primarySpaceId,
        geometry,
        featureIds: selected ? [selected.id] : [],
        regionPath: regions.draft
          ? []
          : regions.ancestry.map((id) => regions.regions.find((region) => region.id === id)!),
      }
    : null;
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
export type FinishedMapModel = Model;
export function FinishedMapEditor(props: Props) {
  const model = useFinishedMap(props);
  const authoring = useRealScaleAuthoring(props.map, props.context.editing, (space) =>
    model.change((value) => ({
      ...value,
      realScale: { ...(value.realScale ?? defaultRealScalePresentation()), space },
    }))
  );
  const structure = useStructureServices(props, authoring);
  const {
    regions: { draft },
    setPanel,
  } = model;
  useEffect(() => {
    if (draft) setPanel("regions");
  }, [draft, setPanel]);
  return (
    <StructureProvider value={structure}>
      <div className="app-shell finished-atlas">
        <FinishedHeader model={model} />
        <FinishedMapBar model={model} />
        <PublishedSelectionToolbar
          tool={model.tool}
          setTool={model.setTool}
          clear={model.clear}
          selected={!!(model.selection || model.selected || model.inspection)}
          realScale={!!props.map.realScale}
          enabled={props.map.regionScale.enabled && !!model.navigation.state}
        />
        <FinishedCanvas model={model} authoring={authoring} />
        {model.panel && <FinishedControls model={model} />}
        <FinishedSidebar model={model} authoring={authoring} />
      </div>
    </StructureProvider>
  );
}
function FinishedSidebar({ model, authoring }: { model: Model; authoring: AuthoringSession }) {
  return model.tool === "edit" && model.map.realScale ? (
    <RealScaleEditor
      session={authoring}
      reader={model.context.maps}
      units={model.value.realScale?.units ?? "metres"}
    />
  ) : (
    (model.inspection || model.selected) && <FinishedInspection model={model} />
  );
}
function FinishedHeader({ model }: { model: Model }) {
  const { props, map, context, panel, setPanel } = model;
  return (
    <>
      {" "}
      <header className="app-header">
        <Brand />
        <strong>{map.name}</strong>
        <button onClick={props.create}>New world</button>
        <button onClick={props.library}>
          {context.mode === "backend" ? "Server maps" : "Saved maps"}
        </button>
        <button onClick={props.lore}>Lore</button>
      </header>
      <nav className="map-navigation" aria-label="Workspace panels">
        {["regions", "appearance", "layers", "views", "registry", "history"].map((id) => (
          <button
            key={id}
            aria-expanded={panel === id}
            aria-controls="map-drawer"
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
  const { map, context, value, tool, selection, inspect, regions, error } = model;
  return (
    <main className="map-workspace">
      <MapSelectionMenu
        refine={model.refineSelection}
        properties={() => {
          if (model.selected || model.inspection)
            document.getElementById("selection-properties")?.focus();
          else model.setPanel("regions");
        }}
        clear={model.clear}
        selected={!!(selection || model.selected || model.inspection)}
        refinable={!!selection && map.regionScale.enabled}
      >
        <PublishedMapCanvas
          map={map}
          reader={context.maps}
          spaceId={shownSpace(map, value.realScale)}
          presentation={value}
          tool={tool}
          selection={selection}
          highlight={model.selected?.footprint ?? model.selected?.geometry}
          onInspection={inspect}
          regionEvents={regions}
          onEngine={() => {}}
          authoring={map.realScale ? authoring : undefined}
        />
      </MapSelectionMenu>
      <ErrorMessage error={error} />
    </main>
  );
}
function FinishedControls({ model }: { model: Model }) {
  const { map, context, value, change, navigation, regions, panel, setPanel } = model;
  return (
    <aside className="map-drawer" id="map-drawer" aria-label="Map controls">
      <div className="drawer-heading">
        <h2>{panel[0].toUpperCase() + panel.slice(1)}</h2>
        <button aria-label="Close panel" onClick={() => setPanel("")}>
          ×
        </button>
      </div>
      <div className="finished-panel-content">
        {panel === "regions" && (
          <>
            <PublishedRegionsPanel
              map={map}
              regions={regions}
              saved={navigation}
              refine={model.refine}
              refineSelection={model.refineSelection}
            />
            <RelatedMaps {...model.props} />
          </>
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
            selected={model.selected?.id ?? null}
            open={(row) => model.select(publishedFeature(row.feature))}
            hidden={(row) =>
              value.styles.some((style) => style.layerId === row.feature.layerId && !style.visible)
            }
          />
        )}
        {panel === "history" && <FinishedHistory context={context} map={map} />}
      </div>
    </aside>
  );
}
function FinishedInspection({ model }: { model: Model }) {
  const { props, map, context, inspection, setInspection, selected, select } = model;
  return (
    <aside
      className="right-panel selection-sidebar"
      id="selection-properties"
      aria-label="Selection properties"
      tabIndex={-1}
    >
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
            if (geometry) model.refineSelection();
            else model.setTool("region-outline");
          }}
        />
      )}
    </aside>
  );
}
