import { useState } from "react";
import type { EditorState } from "./useEditor";
import type { World } from "./types";
import { defaultRasterPresentation } from "./rasterPresentation";

export function MapViews({editor}: {editor: EditorState}) {
  const [name,setName] = useState("");
  const views = editor.world.views.filter((v) => !v.region);
  const open = (view: World["views"][number]) => {
    editor.enter(view.areaId);
    if (view.regionId) editor.enterRegion(view.regionId);
    editor.setRasterView(view.raster ?? defaultRasterPresentation());
    editor.openComposition(view);
  };
  return <section className="map-views">
    <h3>Saved views</h3>
    <p className="hint">Keep different compositions of the same geography. Use Save map to retain them across reloads.</p>
    <form className="save-map-view" onSubmit={(event) => {event.preventDefault(); editor.saveComposition(name.trim());}}>
      <label>View name<input value={name} required placeholder="e.g. Northern kingdoms" onChange={(event) => setName(event.target.value)} /></label>
      <button disabled={!name.trim()}>Save map view</button>
    </form>
    {views.length ? <ul className="saved-view-list">{views.map((view) => <li key={view.id}>
      <div><button className="quiet" aria-current={editor.compositionId === view.id ? "true" : undefined} onClick={() => open(view)}>{view.name}</button>
        <small>{viewContext(editor.world,view)}</small></div>
      <button className="quiet" aria-label={`Remove ${view.name}`} onClick={() => editor.execute("removeView",{id:view.id})}>×</button>
    </li>)}</ul> : <p className="empty-views">No saved views yet.</p>}
  </section>;
}
function viewContext(world: World, view: World["views"][number]) {
  const region = world.views.find((v) => v.id === view.regionId);
  const area = region?.name ?? world.areas[view.areaId]?.name ?? "Source map";
  const mode = view.cartography?.mode === "drawn" ? "Drawn" : "Raster";
  return `${area} · ${mode}`;
}
