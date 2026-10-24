import { useState } from "react";
import type { EditorState } from "./useEditor";
import type { FieldStyle } from "./types";
import { fieldLabel } from "./rasterPresentation";
import { commonOverlay, overlayTheme, overlayThemes, overlayBranch } from "./overlayFields";
export function LayerCatalogue({
  id,
  editor,
  update,
  remove,
}: {
  id: string;
  editor: EditorState;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const selected = new Set(editor.rasterView.fields.map((f) => f.channel));
  const channels = [...new Set((editor.raster.data ?? []).map((r) => r.channel))];
  const matches = channels
    .filter((channel) =>
      search
        ? `${fieldLabel(editor.world, channel)} ${channel}`
            .toLowerCase()
            .includes(search.toLowerCase())
        : all || commonOverlay(channel) || selected.has(channel)
    )
    .sort((a, b) => fieldLabel(editor.world, a).localeCompare(fieldLabel(editor.world, b)));
  return (
    <section className="overlay-catalogue" aria-label="Add map overlays" id={id} popover="auto">
      <header className="catalogue-heading">
        <h3>Add overlays</h3>
        <button className="quiet" popoverTarget={id} popoverTargetAction="hide">
          Done
        </button>
      </header>
      <div className="catalogue-filters">
        <input
          type="search"
          aria-label="Search overlays"
          value={search}
          placeholder="Find a field…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          All fields
        </label>
      </div>
      <div className="catalogue-results">
        <CatalogueGroups
          editor={editor}
          matches={matches}
          selected={selected}
          mode={Boolean(search) || all}
          update={update}
          remove={remove}
        />
      </div>
      {!matches.length && (
        <p className="hint">
          {channels.length
            ? "No matching fields. Try another theme or search."
            : "Generate or paint fields to make overlays available."}
        </p>
      )}
      <footer className="catalogue-footer">
        {matches.length} of {channels.length} fields · Uncheck to remove from the map
      </footer>
    </section>
  );
}
function CatalogueGroups({
  editor,
  matches,
  selected,
  mode,
  update,
  remove,
}: {
  editor: EditorState;
  matches: string[];
  selected: Set<string>;
  mode: boolean;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  return (
    <>
      {overlayThemes.map((theme) => {
        const members = matches.filter((channel) => overlayTheme(channel) === theme);
        if (!members.length) return null;
        return (
          <details className="overlay-group" key={`${theme}:${mode}`} open>
            <summary>
              {theme}
              <small>{members.length}</small>
            </summary>
            <CatalogueBranches
              editor={editor}
              members={members}
              selected={selected}
              update={update}
              remove={remove}
            />
          </details>
        );
      })}
    </>
  );
}
function CatalogueBranches({
  editor,
  members,
  selected,
  update,
  remove,
}: {
  editor: EditorState;
  members: string[];
  selected: Set<string>;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  return (
    <>
      {[...new Set(members.map((channel) => overlayBranch(editor.world, channel)))].map(
        (branch) => {
          const channels = members.filter(
            (channel) => overlayBranch(editor.world, channel) === branch
          );
          const rows = channels.map((channel) => (
            <CatalogueRow
              key={channel}
              editor={editor}
              channel={channel}
              selected={selected.has(channel)}
              update={update}
              remove={remove}
            />
          ));
          return branch ? (
            <details className="overlay-group" key={branch} open>
              <summary>
                {branch}
                <small>{channels.length}</small>
              </summary>
              {rows}
            </details>
          ) : (
            <div key="fields">{rows}</div>
          );
        }
      )}
    </>
  );
}
function CatalogueRow({
  editor,
  channel,
  selected,
  update,
  remove,
}: {
  editor: EditorState;
  channel: string;
  selected: boolean;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  const name = fieldLabel(editor.world, channel);
  const unit = editor.raster.data!.find((r) => r.channel === channel)!.field.units[channel];
  return (
    <label className="catalogue-option">
      <input
        type="checkbox"
        aria-label={`Add ${name}`}
        checked={selected}
        onChange={(e) => (e.target.checked ? update(channel, { visible: true }) : remove(channel))}
      />
      <span title={channel}>{name}</span>
      <small title={unit}>{unit === "category" ? "Classes" : unit}</small>
    </label>
  );
}
