import { useState } from "react";
import type { FieldStyle } from "./types";
export interface OverlayChoice {
  id: string;
  name: string;
  unit: string;
  theme: string;
  branch: string;
  common: boolean;
}
export function OverlayCatalogue({
  id,
  fields,
  choices,
  update,
  remove,
}: {
  id: string;
  fields: FieldStyle[];
  choices: OverlayChoice[];
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const selected = new Set(fields.map((f) => f.channel));
  const channels = choices;
  const matches = channels
    .filter((channel) =>
      search
        ? `${channel.name} ${channel.id}`.toLowerCase().includes(search.toLowerCase())
        : all || channel.common || selected.has(channel.id)
    )
    .sort((a, b) => a.name.localeCompare(b.name));
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
  matches,
  selected,
  mode,
  update,
  remove,
}: {
  matches: OverlayChoice[];
  selected: Set<string>;
  mode: boolean;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  return (
    <>
      {[...new Set(matches.map((choice) => choice.theme))].map((theme) => {
        const members = matches.filter((channel) => channel.theme === theme);
        if (!members.length) return null;
        return (
          <details className="overlay-group" key={`${theme}:${mode}`} open>
            <summary>
              {theme}
              <small>{members.length}</small>
            </summary>
            <CatalogueBranches
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
  members,
  selected,
  update,
  remove,
}: {
  members: OverlayChoice[];
  selected: Set<string>;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  return (
    <>
      {[...new Set(members.map((channel) => channel.branch))].map((branch) => {
        const channels = members.filter((channel) => channel.branch === branch);
        const rows = channels.map((channel) => (
          <CatalogueRow
            key={channel.id}
            channel={channel}
            selected={selected.has(channel.id)}
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
      })}
    </>
  );
}
function CatalogueRow({
  channel,
  selected,
  update,
  remove,
}: {
  channel: OverlayChoice;
  selected: boolean;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
  remove: (channel: string) => void;
}) {
  const { name, unit, id } = channel;
  return (
    <label className="catalogue-option">
      <input
        type="checkbox"
        aria-label={`Add ${name}`}
        checked={selected}
        onChange={(e) => (e.target.checked ? update(id, { visible: true }) : remove(id))}
      />
      <span title={id}>{name}</span>
      <small title={unit}>{unit}</small>
    </label>
  );
}
