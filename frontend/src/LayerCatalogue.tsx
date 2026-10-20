import { useState } from "react";
import type { EditorState } from "./useEditor";
import type { FieldStyle } from "./types";
import { fieldLabel } from "./rasterPresentation";

const recommended = new Set([
  "temperature",
  "precipitation",
  "moisture",
  "flow",
  "ice",
  "population",
  "naturalSurface",
  "finalSurface",
]);
const themes = [
  "Recommended",
  "Climate",
  "Water",
  "Terrain",
  "People",
  "Magic",
  "Advanced",
  "All fields",
];
function fieldTheme(channel: string) {
  if (channel.startsWith("magic:")) return "Magic";
  if (/^(culture|language|religion):|population|settlement/.test(channel)) return "People";
  if (/temperature|rain|snow|moisture|precipitation|wind|runoff/i.test(channel)) return "Climate";
  if (/water|flow|river|ice|sea|ocean|basin|catchment/i.test(channel)) return "Water";
  if (/surface|bedrock|sediment|erosion|landform|fracture|rock|elevation/i.test(channel))
    return "Terrain";
  return "Advanced";
}
export function LayerCatalogue({
  editor,
  update,
}: {
  editor: EditorState;
  update: (channel: string, changes: Partial<FieldStyle>) => void;
}) {
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("Recommended");
  const channels = [...new Set((editor.raster.data ?? []).map((r) => r.channel))];
  const matches = channels
    .filter((channel) => {
      if (search)
        return `${fieldLabel(editor.world, channel)} ${channel}`
          .toLowerCase()
          .includes(search.toLowerCase());
      if (theme === "Recommended")
        return recommended.has(channel) || channel.endsWith(":intensity");
      return theme === "All fields" || fieldTheme(channel) === theme;
    })
    .sort((a, b) => fieldLabel(editor.world, a).localeCompare(fieldLabel(editor.world, b)));
  return (
    <section className="overlay-catalogue" aria-label="Add map overlays">
      <div className="catalogue-filters">
        <input
          type="search"
          aria-label="Search overlays"
          value={search}
          placeholder="Find a field…"
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Overlay theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
          {themes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="catalogue-results">
        {matches.map((channel) => {
          const field = editor.rasterView.fields.find((f) => f.channel === channel);
          const unit = editor.raster.data!.find((r) => r.channel === channel)!.field.units[channel];
          return (
            <label className="catalogue-option" key={channel}>
              <input
                type="checkbox"
                aria-label={`Add ${fieldLabel(editor.world, channel)}`}
                checked={field?.visible ?? false}
                onChange={(e) => update(channel, { visible: e.target.checked })}
              />
              <span>
                {fieldLabel(editor.world, channel)}
                <small>
                  {fieldTheme(channel)} · {unit}
                </small>
              </span>
            </label>
          );
        })}
      </div>
      {!matches.length && (
        <p className="hint">
          {channels.length
            ? "No matching fields. Try another theme or search."
            : "Generate or paint fields to make overlays available."}
        </p>
      )}
    </section>
  );
}
