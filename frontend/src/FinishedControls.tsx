import type { FinishedMapModel as Model } from "./FinishedMapEditor";
import { FinishedHistory } from "./FinishedMapPanels";
import { MapTree } from "./MapTree";
import { PublishedAppearance } from "./PublishedAppearance";
import { PublishedLayerPanel } from "./PublishedLayerPanel";
import { PublishedMapViews } from "./PublishedMapViews";
import { PublishedRegionsPanel } from "./PublishedRegionsPanel";
import { PublishedRegistry } from "./PublishedRegistry";
import { PublishedSheetPanel } from "./PublishedSheetPanel";
import { RealScaleControls } from "./RealScaleControls";
import { publishedFeature } from "./publishedAppearance";

function RegionsPanel({ model }: { model: Model }) {
  return (
    <PublishedRegionsPanel
      map={model.map}
      regions={model.regions}
      saved={model.navigation}
      refine={model.refine}
      refineSelection={model.refineSelection}
    />
  );
}
function AppearancePanel({ model }: { model: Model }) {
  const { map, context, value, change } = model;
  return (
    <>
      <RealScaleControls map={map} reader={context.maps} value={value} change={change} />
      <PublishedAppearance map={map} reader={context.maps} value={value} change={change} />
      {value.drawing.mode === "drawn" && (
        <PublishedSheetPanel map={map} reader={context.maps} value={value} change={change} />
      )}
    </>
  );
}
function RegistryPanel({ model }: { model: Model }) {
  const { map, context, value } = model;
  return (
    <PublishedRegistry
      map={map}
      reader={context.maps}
      selected={model.selected?.id ?? null}
      open={(row) => model.select(publishedFeature(row.feature))}
      hidden={(row) =>
        value.styles.some((style) => style.layerId === row.feature.layerId && !style.visible)
      }
    />
  );
}
function ViewsPanel({ model }: { model: Model }) {
  const { map, value, change, navigation, regions } = model;
  return (
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
  );
}
function PanelContent({ model }: { model: Model }) {
  const { map, context, value, change, panel } = model;
  switch (panel) {
    case "maps":
      return <MapTree context={context} map={map} open={model.props.open} />;
    case "regions":
      return <RegionsPanel model={model} />;
    case "appearance":
      return <AppearancePanel model={model} />;
    case "layers":
      return <PublishedLayerPanel map={map} reader={context.maps} value={value} change={change} />;
    case "views":
      return <ViewsPanel model={model} />;
    case "registry":
      return <RegistryPanel model={model} />;
    case "history":
      return <FinishedHistory context={context} map={map} />;
  }
  return null;
}
export function FinishedControls({ model }: { model: Model }) {
  const { panel, setPanel } = model;
  return (
    <aside className="map-drawer" id="map-drawer" aria-label="Map controls">
      <div className="drawer-heading">
        <h2>{panel[0].toUpperCase() + panel.slice(1)}</h2>
        <button aria-label="Close panel" onClick={() => setPanel("")}>
          ×
        </button>
      </div>
      <div className="finished-panel-content">
        <PanelContent model={model} />
      </div>
    </aside>
  );
}
