import { spatial } from "@atlas/domain";
import { GenerationForm } from "./DevelopmentPanel";
import { RegionalGeneration } from "./RegionalGeneration";
import { RegionsPanel, RegionList } from "./RegionsPanel";
import { FeatureInformation } from "./FeatureInformation";
import type { EditorState } from "./useEditor";
import type { World } from "./types";
import "./selection.css";

export function SelectionPanel({ world, editor }: { world: World; editor: EditorState }) {
  if (editor.panel === "configure-generation")
    return <RegionalGeneration key={editor.area.id} world={world} editor={editor} />;
  if (editor.panel === "regions" || editor.regionDraft) return <RegionsPanel editor={editor} />;
  if (editor.selected) return <FeatureInformation world={world} editor={editor} />;
  if (editor.region) return <RegionsPanel editor={editor} />;
  return <MapOverview key={editor.area.id} world={world} editor={editor} />;
}

function MapOverview({ world, editor }: { world: World; editor: EditorState }) {
  const generated =
    world.fields.some((field) => field.areaId === editor.area.id) ||
    world.generations.some((generation) => generation.areaId === editor.area.id);
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
      {!editor.area.parentId && !generated && (
        <details open>
          <summary>Generate a starting landscape</summary>
          <p className="hint">
            These settings generate the whole map. To add local detail, choose a region instead.
          </p>
          <GenerationForm world={world} editor={editor} />
        </details>
      )}
    </section>
  );
}
