import { useState } from "react";
import { minimumRegionWidthMetres, spatial } from "@atlas/domain";
import type { EditorState } from "./useEditor";
import { ErrorMessage } from "./ErrorMessage";
import "./regions.css";
import { isRegionTool } from "./useRegions";

export function RegionsPanel({ editor }: { editor: EditorState }) {
  const { region, regions } = editor;
  const choosing = Boolean(editor.regionDraft) || isRegionTool(editor.tool);
  const children = regions.filter((r) => r.region.parentId === selectionParent(editor));
  return (
    <section className="regions-panel">
      <RegionHeading editor={editor} />
      {region && !choosing && <SelectedRegion editor={editor} />}
      <RegionSelection editor={editor} />
      {region && !choosing && (
        <button className="secondary" onClick={editor.openRegions}>
          Choose a smaller region
        </button>
      )}
      <ErrorMessage error={editor.regionError} />
      {!!editor.regionCuts.length && (
        <button onClick={editor.cancelRegion}>Clear dividing lines</button>
      )}
      <h3>{region ? "Region navigation" : "Chosen regions"}</h3>
      <RegionList editor={editor} />
      <ErrorMessage error={editor.commit.error} />
      {!children.length && <p className="hint">No smaller regions chosen here yet.</p>}
    </section>
  );
}
function RegionSelection({ editor }: { editor: EditorState }) {
  if (editor.regionDraft && editor.tool !== "regionPick")
    return <RegionDraft key={editor.region?.id ?? "new"} editor={editor} />;
  return isRegionTool(editor.tool) ? <RegionTools editor={editor} /> : null;
}
function RegionHeading({ editor }: { editor: EditorState }) {
  return (
    <>
      <p className="eyebrow">
        {editor.regionDraft
          ? "REGION OUTLINE"
          : isRegionTool(editor.tool)
            ? "CHOOSE A REGION"
            : "SELECTED REGION"}
      </p>
      <h2>{editor.region?.name ?? editor.area.name}</h2>
      {!editor.region && (
        <p>
          Choose the part of this map you want to explore. Selecting a region does not generate or
          change geography.
        </p>
      )}
    </>
  );
}
function SelectedRegion({ editor }: { editor: EditorState }) {
  const region = editor.region!;
  const refined = Object.values(editor.world.areas).some(
    (area) =>
      area.regionId === region.id &&
      editor.world.fields.some((field) => field.areaId === area.id && !field.input)
  );
  return (
    <>
      <p>
        {(spatial.area(region.region.footprint) / 1e6).toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })}{" "}
        km² · {refined ? "Regional detail generated" : "Showing existing map detail"}
      </p>
      <div className="selection-next">
        <h3>Add finer detail here</h3>
        <p>
          Resolve smaller valleys, tributaries and places from the geography already on the map.
        </p>
        <button
          className="primary"
          onClick={editor.refineSelectedRegion}
          disabled={editor.commit.isPending}
        >
          Refine this region
        </button>
      </div>
      <RegionDetails key={`${region.id}:${region.name}`} editor={editor} />
    </>
  );
}
function RegionTools({ editor }: { editor: EditorState }) {
  const instructions: Record<string, string> = {
    regionPick: editor.regionCuts.length
      ? "Click the side of the dividing line you want to keep. Its boundary will be combined with the surrounding geography."
      : "Click inside a geographic or territorial boundary. Zoom in for smaller candidates. If no boundary fits, draw an outline.",
    regionOutline:
      "Click around the region you want. Double-click or press Enter to finish. The outline stays within the current region.",
    regionCut:
      "Draw a line between rivers, shores or the current outline. Double-click to finish, then click the side you want to keep.",
  };
  return (
    <>
      <h3>{editor.region ? "Choose a smaller region" : "How would you like to select it?"}</h3>
      <div className="region-tool-options" role="group" aria-label="Region tools">
        <button
          aria-label="Use an existing boundary"
          aria-pressed={editor.tool === "regionPick"}
          onClick={() => editor.setTool("regionPick")}
        >
          <strong>Use an existing boundary</strong>
          <small>Pick a region enclosed by geography or territory.</small>
        </button>
        <button
          aria-label="Trace a custom outline"
          aria-pressed={editor.tool === "regionOutline"}
          onClick={() => editor.setTool("regionOutline")}
        >
          <strong>Trace a custom outline</strong>
          <small>Choose an area without an existing boundary.</small>
        </button>
        <button
          aria-label="Divide along a line"
          aria-pressed={editor.tool === "regionCut"}
          onClick={() => editor.setTool("regionCut")}
        >
          <strong>Divide along a line</strong>
          <small>Combine your line with rivers, shores or the current boundary.</small>
        </button>
      </div>
      {instructions[editor.tool] && (
        <p className="selection-instruction" role="status">
          {instructions[editor.tool]} Press Escape to cancel.
        </p>
      )}
      <button className="quiet" onClick={editor.cancelRegion}>
        Cancel region selection
      </button>
    </>
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
        {editor.editingRegion
          ? `Adjust the boundary of ${editor.region!.name}. Keeping this outline updates the same region.`
          : `This outline becomes a region within ${editor.region?.name ?? editor.area.name}. Keep it to inspect or refine it.`}
      </p>
      <p>
        {(spatial.area(draft.footprint) / 1e6).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}{" "}
        km²
      </p>
      <p className="hint">
        {editor.tool === "regionEdit"
          ? "Drag outline vertices to adjust the boundary."
          : "Choose Adjust selected outline to move its vertices."}{" "}
        Minimum useful width: {minimumRegionWidthMetres} m.
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
      {editor.tool !== "regionEdit" && (
        <button type="button" onClick={() => editor.setTool("regionEdit")}>
          Adjust selected outline
        </button>
      )}
      <button type="button" onClick={editor.cancelRegion}>
        Discard outline
      </button>
    </form>
  );
}
export function RegionList({ editor }: { editor: EditorState }) {
  const children = editor.regions.filter((r) => r.region.parentId === selectionParent(editor));
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
function selectionParent(editor: EditorState) {
  return editor.region?.areaId === editor.area.id ? editor.region.id : null;
}
function RegionDetails({ editor }: { editor: EditorState }) {
  const [name, setName] = useState(editor.region!.name);
  const refined = Object.values(editor.world.areas).some(
    (area) => area.regionId === editor.region!.id
  );
  const attached =
    editor.world.views.some(
      (v) => v.region?.parentId === editor.region!.id || v.regionId === editor.region!.id
    ) || refined;
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
      <button disabled={refined} onClick={editor.adjustRegion}>
        Adjust outline
      </button>
      {refined && (
        <p className="hint">
          A finer map uses this outline. Choose a new region for a different extent.
        </p>
      )}
      <button disabled={attached || editor.commit.isPending} onClick={editor.removeRegion}>
        Remove region
      </button>
      {attached && (
        <p className="hint">Retained by a finer map, child regions or saved map views.</p>
      )}
    </details>
  );
}
