import type { EditorState } from "./useEditor";
import type { ReactNode } from "react";
import { AtlasPanel } from "./AtlasPanel";
import { MapAppearance } from "./MapAppearance";
import { LayerPanel } from "./LayerPanel";
import { DrawnSheetPanel } from "./DrawnSheetPanel";
import { MapViews } from "./MapViews";
import { ErrorMessage } from "./ErrorMessage";
import "./mapSettings.css";

export type MapSection = "appearance" | "layers" | "sheet" | "views";
const sections: [MapSection, string][] = [
  ["appearance", "Appearance"],
  ["layers", "Layers"],
  ["sheet", "Sheet"],
  ["views", "Views"],
];
interface Props {
  editor: EditorState;
  section: MapSection;
  choose: (section: MapSection) => void;
  chooseRegion: () => void;
}
export function MapDrawer({
  editor,
  tab,
  section,
  choose,
  close,
  maps,
}: Omit<Props, "chooseRegion"> & { tab: string; close: () => void; maps: ReactNode }) {
  return (
    <aside
      className="left-panel map-drawer"
      id="map-drawer"
      aria-label={tab === "map" ? "Map settings" : "World atlas"}
    >
      <header className="drawer-heading">
        <h2>{tab === "map" ? "Map" : "Atlas"}</h2>
        <button className="quiet" aria-label="Close map drawer" onClick={close}>
          ×
        </button>
      </header>
      {tab === "atlas" ? (
        <AtlasPanel editor={editor} maps={maps} />
      ) : (
        <MapPanel
          editor={editor}
          section={section}
          choose={choose}
          chooseRegion={() => {
            editor.openRegions();
            close();
          }}
        />
      )}
    </aside>
  );
}
export function MapPanel({ editor, section, choose, chooseRegion }: Props) {
  return (
    <div className="map-settings">
      <div className="map-context">
        <div>
          <span className="eyebrow">AREA</span>
          <strong>{editor.region?.name ?? editor.area.name}</strong>
          <small>
            {editor.region ? `Region in ${editor.area.name}` : `${editor.area.profile} map`}
          </small>
        </div>
        <button className="quiet" onClick={chooseRegion}>
          Choose region
        </button>
      </div>
      {editor.cartography.mode === "drawn" && (
        <label className="map-scope-clip check">
          <input
            type="checkbox"
            checked={editor.cartography.clip}
            onChange={(event) =>
              editor.setCartography({ ...editor.cartography, clip: event.target.checked })
            }
          />
          Clip to this area
        </label>
      )}
      <nav className="map-settings-tabs" aria-label="Map sections">
        {sections.map(([id, label]) => (
          <button
            key={id}
            aria-pressed={section === id}
            aria-controls="map-settings-content"
            onClick={() => choose(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="map-settings-content" id="map-settings-content">
        {section === "appearance" && <MapAppearance editor={editor} />}
        {section === "layers" && <LayerPanel world={editor.world} editor={editor} />}
        {section === "sheet" && <SheetSettings editor={editor} />}
        {section === "views" && <MapViews editor={editor} />}
        <ErrorMessage error={editor.compositionError} />
      </div>
      <footer className="map-view-status">
        <span>{editor.compositionId ? editor.compositionName : "Unsaved view"}</span>
        <button className="quiet" onClick={() => choose("views")}>
          Save view…
        </button>
      </footer>
    </div>
  );
}
function SheetSettings({ editor }: { editor: EditorState }) {
  if (editor.cartography.mode === "drawn") return <DrawnSheetPanel editor={editor} />;
  return (
    <section className="map-sheet-intro">
      <h3>Finished sheet</h3>
      <p>Compose a drawn map with a title, legend and scale, then download a PNG.</p>
      <button onClick={() => editor.setCartography({ ...editor.cartography, mode: "drawn" })}>
        Switch to drawn map
      </button>
    </section>
  );
}
