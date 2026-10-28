import { spatial } from "@atlas/domain";
import { RegionalGeneration } from "./RegionalGeneration";
import { RegionsPanel, RegionList } from "./RegionsPanel";
import { FeatureInformation } from "./FeatureInformation";
import type { EditorState } from "./useEditor";
import type { World } from "./types";
import "./selection.css";
import { isRegionTool } from "./useRegions";

export function SelectionPanel({ world, editor }: { world: World; editor: EditorState }) {
  if (editor.panel === "configure-generation")
    return <RegionalGeneration key={editor.area.id} world={world} editor={editor} />;
  if (isRegionTool(editor.tool) || editor.regionDraft) return <RegionsPanel editor={editor} />;
  if (editor.selected) return <FeatureInformation world={world} editor={editor} />;
  if (editor.region) return <RegionsPanel editor={editor} />;
  return <MapOverview key={editor.area.id} editor={editor} />;
}

function MapOverview({ editor }: { editor: EditorState }) {
  return (
    <section className="selection-overview">
      <p className="eyebrow">CURRENT MAP</p>
      <h2>{editor.area.name}</h2>
      <p>Click a feature on the map to see what it is and how it formed.</p>
      <dl>
        <dt>Map area</dt>
        <dd>{(spatial.area(editor.area.footprint) / 1e6).toLocaleString()} km²</dd>
      </dl>
      <div className="selection-next">
        <h3>Explore a smaller region</h3>
        <p>Choose an existing boundary or trace an outline. Then add finer geographic detail.</p>
        <button className="primary" onClick={editor.openRegions}>
          Choose a region
        </button>
      </div>
      <RegionList editor={editor} />
    </section>
  );
}
