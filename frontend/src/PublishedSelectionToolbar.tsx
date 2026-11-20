import type { PublishedTool } from "./publishedInteractions";

interface ToolButton {
  id: PublishedTool;
  label: string;
  title: string;
}
const lookTools: ToolButton[] = [
  { id: "pan", label: "Pan", title: "Drag to move the map" },
  {
    id: "inspect",
    label: "Inspect",
    title: "Click the map to list the features and stored values at that point",
  },
];
const regionTools: ToolButton[] = [
  {
    id: "region-pick",
    label: "Click boundary",
    title:
      "Click inside a mapped boundary, such as a coast or territory, to select it. Shift+drag a line across the boundary first to select just one side.",
  },
  {
    id: "region-outline",
    label: "Draw polygon",
    title: "Click each corner; double-click or press Enter to finish",
  },
  {
    id: "region-lasso",
    label: "Draw freehand",
    title: "Press and drag around the area you want",
  },
];

function ToolGroup({
  label,
  tools,
  tool,
  setTool,
  enabled = true,
}: {
  label: string;
  tools: ToolButton[];
  tool: PublishedTool;
  setTool(tool: PublishedTool): void;
  enabled?: boolean;
}) {
  return (
    <div className="tool-group" role="group" aria-label={label}>
      <span>{label}</span>
      {tools.map(({ id, label, title }) => (
        <button
          key={id}
          title={title}
          aria-pressed={tool === id}
          disabled={!enabled}
          onClick={() => setTool(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
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
    <nav className="selection-toolbar" aria-label="Map toolbar">
      <ToolGroup label="View" tools={lookTools} tool={tool} setTool={setTool} />
      <ToolGroup
        label="Select a region by"
        tools={regionTools}
        tool={tool}
        setTool={setTool}
        enabled={enabled}
      />
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
