import type { Tool } from "./types";
import { drawingTools } from "./cartography";
const paths: Record<string, string> = {
  select: "M4 3 18 12 11 13 8 20Z",
  pan: "M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4",
  move: "M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4",
  reshape: "M5 5 18 8 15 19 5 5M3 3h4v4H3ZM16 6h4v4h-4ZM13 17h4v4h-4Z",
  poi: "M12 3v3M12 18v3M3 12h3M18 12h3M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10",
  road: "M4 3c14 2-10 15 6 18M10 3c14 2-10 15 6 18",
  river: "M3 7c4-7 7 7 11 0s7 0 7 0M3 16c4-7 7 7 11 0s7 0 7 0",
  polygon: "M6 3 19 5 22 15 13 21 3 15Z",
  refine: "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8Z",
  sculpt: "M3 18 8 9 13 15 17 5 22 18ZM5 21h15",
};
export function ToolIcon({ tool }: { tool: Tool }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={
          paths[tool] ??
          paths[
            drawingTools[tool]?.geometry === "Point"
              ? "poi"
              : drawingTools[tool]?.geometry === "LineString"
                ? "road"
                : "polygon"
          ]
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
