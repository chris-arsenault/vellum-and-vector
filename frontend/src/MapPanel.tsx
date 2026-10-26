import type { EditorState } from "./useEditor";
import { CartographicPanel } from "./CartographicPanel";
import { LayerPanel } from "./LayerPanel";
import { DrawnSheetPanel } from "./DrawnSheetPanel";
import { MapViews } from "./MapViews";
import { ErrorMessage } from "./ErrorMessage";

export type MapSection = "appearance" | "layers" | "sheet" | "views";
const sections: [MapSection, string][] = [
  ["appearance", "Appearance"], ["layers", "Layers"], ["sheet", "Sheet"], ["views", "Views"],
];
interface Props {
  editor: EditorState;
  section: MapSection;
  choose: (section: MapSection) => void;
  chooseRegion: () => void;
}
export function MapPanel({editor,section,choose,chooseRegion}: Props) {
  return <div className="map-settings">
    <div className="map-context">
      <div><span className="eyebrow">AREA</span><strong>{editor.region?.name ?? editor.area.name}</strong>
        <small>{editor.region ? `Region in ${editor.area.name}` : `${editor.area.profile} map`}</small>
      </div>
      <button className="quiet" onClick={chooseRegion}>Choose region</button>
    </div>
    <nav className="map-settings-tabs" aria-label="Map settings">
      {sections.map(([id,label]) => <button key={id} aria-pressed={section === id} aria-controls="map-settings-content" onClick={() => choose(id)}>{label}</button>)}
    </nav>
    <div className="map-settings-content" id="map-settings-content">
      {section === "appearance" && <CartographicPanel editor={editor} />}
      {section === "layers" && <LayerPanel world={editor.world} editor={editor} />}
      {section === "sheet" && <SheetSettings editor={editor} />}
      {section === "views" && <MapViews editor={editor} />}
      <ErrorMessage error={editor.compositionError} />
    </div>
    <footer className="map-view-status"><span>{editor.compositionId ? editor.compositionName : "Unsaved view"}</span>
      <button className="quiet" onClick={() => choose("views")}>Save view…</button>
    </footer>
  </div>;
}
function SheetSettings({editor}: {editor: EditorState}) {
  if (editor.cartography.mode === "drawn") return <DrawnSheetPanel editor={editor} />;
  return <section className="map-sheet-intro"><h3>Finished sheet</h3>
    <p>Compose a drawn map with a title, legend and scale, then download a PNG.</p>
    <button onClick={() => editor.setCartography({...editor.cartography,mode:"drawn"})}>Switch to drawn map</button>
  </section>;
}
