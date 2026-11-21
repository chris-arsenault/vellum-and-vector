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
import { FinishedControls } from "./FinishedControls";
import type { ViewedChrome } from "./carriedPresentation";
import { useViewedChrome } from "./useViewedChrome";
import { PointPickMenu } from "./PointPickMenu";
import { usePointPick } from "./usePointPick";
import type { AtlasContext } from "@atlas/context";
import { Brand } from "./Brand";
import { PublishedMapCanvas } from "./PublishedMapCanvas";
import { PublishedCellInspection } from "./PublishedCellInspection";
import { PublishedFeatureInformation } from "./PublishedFeatureInformation";
import { usePublishedNavigation } from "./usePublishedNavigation";
import { usePublishedRegions, usePublishedRegionPresentation } from "./usePublishedRegions";
import { publishedFeature, type PublishedFeature } from "./publishedAppearance";
import type { PublishedTool } from "./publishedInteractions";
import { ErrorMessage } from "./ErrorMessage";
import { RealScaleOpen } from "./RealScaleOpen";
import { CityOpen } from "./CityOpen";
import { defaultRealScalePresentation, shownSpace } from "./realScale";
import { RealScaleEditor } from "./RealScaleEditor";
import { AuthoredEditor } from "./AuthoredEditor";
import { StructureProvider, useStructureServices } from "./structureServices";
import { useRealScaleAuthoring, type AuthoringSession } from "./useRealScaleAuthoring";
import type { CityChoice, RealScaleChoice } from "@atlas/context";
import "./mapSettings.css";
import "./finishedWorkspace.css";

interface Props {
  context: Pick<
    AtlasContext<unknown>,
    "maps" | "library" | "navigation" | "editing" | "mode" | "contexts"
  >;
  map: MapDescriptor;
  saved?: SavedMapDocument;
  /** The presentation of the map viewed before this one; layer choices carry over. */
  viewed?: ViewedChrome;
  open(reference: MapRef): void;
  create(): void;
  /** Start a blank map to draw by hand. */
  newMap?(): void;
  lore(): void;
  library(): void;
  refine(
    selection: RegionSelection,
    name: string,
    child?: MapRef,
    realScale?: RealScaleChoice,
    city?: CityChoice
  ): void;
  regenerate(): void;
}
// owner-direction(2026-11-14): presentation reads only GIS map storage, never numerical generation storage.
function useFinishedMap(props: Props) {
  const { map, context } = props;
  const chrome = useViewedChrome(map, props.saved, props.viewed);
  const { appearance, change, tool, setRegionTool, panel, showPanel } = chrome;
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [selected, select] = useState<PublishedFeature | null>(null);
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
  const point = usePointPick((feature, cell) => {
    regions.select(null);
    setInspection(cell);
    select(feature && publishedFeature(feature));
  });
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
      point,
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
  if (model.tool === "edit" && model.map.realScale?.kind === "authored")
    return <AuthoredEditor session={authoring} reader={model.context.maps} />;
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
        {props.newMap && <button onClick={props.newMap}>New map</button>}
        <button onClick={props.library}>
          {context.mode === "backend" ? "Server maps" : "Saved maps"}
        </button>
        <button onClick={props.lore}>Lore</button>
      </header>
      <nav className="map-navigation" aria-label="Workspace panels">
        {["maps", "regions", "appearance", "layers", "views", "registry", "history"].map((id) => (
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
  const { map, context, value, tool, selection, regions, error } = model;
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
          onInspection={model.point.inspect}
          regionEvents={regions}
          onEngine={() => {}}
          authoring={map.realScale ? authoring : undefined}
        />
      </MapSelectionMenu>
      <PointPickMenu
        map={map}
        pick={model.point.pick}
        choose={model.point.choose}
        cancel={model.point.cancel}
      />
      <ErrorMessage error={error} />
    </main>
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
      {selected && map.state === "complete" && (
        <CityOpen
          key={selected.id}
          map={map}
          feature={selected}
          open={(selection, name, realScale, city) =>
            props.refine(selection, name, undefined, realScale, city)
          }
        />
      )}
      {(inspection || !selected) && <PublishedCellInspection map={map} inspection={inspection} />}
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
