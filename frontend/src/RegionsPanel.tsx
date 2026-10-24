import { useState } from "react";
import { minimumRegionWidthMetres, spatial } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import { ErrorMessage } from "./ErrorMessage";
import "./regions.css";

export function RegionsPanel({ editor }: { editor: EditorState }) {
  const { region, regionDraft, regions } = editor;
  const children = regions.filter((r) => r.region.parentId === (region?.id ?? null));
  return (
    <section className="regions-panel">
      <p className="eyebrow">GEOGRAPHIC REGIONS</p>
      <h2>{region?.name ?? editor.area.name}</h2>
      <p>Choose an area on the map, follow existing boundaries or draw your own.</p>
      <div className="region-actions" role="group" aria-label="Region tools">
        <button
          aria-pressed={editor.tool === "regionPick"}
          onClick={() => editor.setTool("regionPick")}
        >
          Pick region
        </button>
        <button
          aria-pressed={editor.tool === "regionOutline"}
          onClick={() => editor.setTool("regionOutline")}
        >
          Draw outline
        </button>
        <button
          aria-pressed={editor.tool === "regionCut"}
          onClick={() => editor.setTool("regionCut")}
        >
          Draw dividing line
        </button>
      </div>
      <p className="hint">
        Dividing lines join rivers, shores or the parent outline. Double-click or press Enter to
        finish. Hold Space to pan.
      </p>
      <ErrorMessage error={editor.regionError} />
      {regionDraft && <RegionDraft key={region?.id ?? "new"} editor={editor} />}
      {!!editor.regionCuts.length && (
        <button onClick={editor.cancelRegion}>Clear dividing lines</button>
      )}
      <RegionList editor={editor} />
      {region && !regionDraft && (
        <RegionDetails key={`${region.id}:${region.name}`} editor={editor} />
      )}
      {!children.length && <p className="hint">No smaller regions chosen here yet.</p>}
      <p className="hint">
        Regions show the map's existing geography. Minimum useful width: {minimumRegionWidthMetres}{" "}
        m.
      </p>
    </section>
  );
}
function RegionDraft({ editor }: { editor: EditorState }) {
  const draft = editor.regionDraft!;
  const [name, setName] = useState(draft.name === "Region" ? "" : draft.name);
  return (
    <form
      className="region-draft"
      onSubmit={(event) => {
        event.preventDefault();
        editor.saveRegion(name);
      }}
    >
      <h3>Selected outline</h3>
      <p>
        {(spatial.area(draft.footprint) / 1e6).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}{" "}
        km²
      </p>
      {editor.regionCandidates.length > 1 && (
        <label>
          Boundary choice
          <select
            value={editor.regionCandidates.indexOf(draft)}
            onChange={(e) =>
              editor.chooseRegionCandidate(editor.regionCandidates[Number(e.target.value)])
            }
          >
            {editor.regionCandidates.map((c, i) => (
              <option key={i} value={i}>
                {c.name} ·{" "}
                {(spatial.area(c.footprint) / 1e6).toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}{" "}
                km²
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Region name <small>optional</small>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="primary" disabled={editor.commit.isPending}>
        Keep region
      </button>
      <button type="button" onClick={() => editor.setTool("regionEdit")}>
        Adjust selected outline
      </button>
      <button type="button" onClick={editor.cancelRegion}>
        Discard outline
      </button>
    </form>
  );
}
export function RegionList({ editor }: { editor: EditorState }) {
  const children = editor.regions.filter((r) => r.region.parentId === (editor.region?.id ?? null));
  return (
    <nav aria-label="Region hierarchy" className="region-list">
      {!!editor.region && (
        <button onClick={() => editor.enterRegion(editor.region!.region.parentId)}>
          ↑ Parent region
        </button>
      )}
      {children.map((r) => (
        <button key={r.id} onClick={() => editor.enterRegion(r.id)}>
          {r.name}
          <small>
            {editor.regions.filter((c) => c.region.parentId === r.id).length} subregions
          </small>
        </button>
      ))}
    </nav>
  );
}
function RegionDetails({ editor }: { editor: EditorState }) {
  const [name, setName] = useState(editor.region!.name);
  const attached = editor.world.views.some(
    (v) => v.region?.parentId === editor.region!.id || v.regionId === editor.region!.id
  );
  return (
    <details>
      <summary>Region details</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          editor.renameRegion(name);
        }}
      >
        <label>
          Rename region
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button disabled={!name.trim() || editor.commit.isPending}>Rename</button>
      </form>
      <button onClick={editor.adjustRegion}>Adjust outline</button>
      <button disabled={attached || editor.commit.isPending} onClick={editor.removeRegion}>
        Remove region
      </button>
      {attached && <p className="hint">Retained by child regions or saved map views.</p>}
    </details>
  );
}
