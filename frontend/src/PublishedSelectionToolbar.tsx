import type { PublishedTool } from "./publishedInteractions";

const tools: { id: PublishedTool; label: string; title: string }[] = [
  { id: "pan", label: "Pan", title: "Drag the map" },
  { id: "inspect", label: "Select feature", title: "Click a feature to select and inspect it" },
  { id: "region-pick", label: "Select boundary", title: "Click inside a geographic boundary" },
  { id: "region-outline", label: "Polygon", title: "Click vertices; double-click to finish" },
  { id: "region-lasso", label: "Lasso", title: "Drag a freehand selection" },
  { id: "region-cut", label: "Dividing line", title: "Draw a line, then click the side to select" },
  { id: "inspect-cell", label: "Inspect place", title: "Inspect geographic values at a point" },
];

// owner-direction(2026-11-17): selection types are tools in a toolbar; select first, then act
export function PublishedSelectionToolbar({
  tool,
  setTool,
  clear,
  selected,
  enabled,
  realScale = false,
}: {
  tool: PublishedTool;
  setTool(tool: PublishedTool): void;
  clear(): void;
  selected: boolean;
  enabled: boolean;
  realScale?: boolean;
}) {
  return (
    <nav className="selection-toolbar" aria-label="Selection tools">
      <span>Selection</span>
      {tools.map(({ id, label, title }) => (
        <button
          key={id}
          title={title}
          aria-pressed={tool === id}
          disabled={id.startsWith("region-") && !enabled}
          onClick={() => setTool(id)}
        >
          {label}
        </button>
      ))}
      <button disabled={!selected} onClick={clear}>
        Clear selection
      </button>
      {realScale && (
        <nav className="real-scale-map-tools" aria-label="Map tools">
          {(["measure", "edit"] as const).map((id) => (
            <button key={id} aria-pressed={tool === id} onClick={() => setTool(id)}>
              {id === "measure" ? "Measure" : "Edit map"}
            </button>
          ))}
        </nav>
      )}
    </nav>
  );
}
