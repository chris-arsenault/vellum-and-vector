import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { commitWorkspaceCommand } from "./workspaceAuthoring";
import { ErrorMessage } from "./ErrorMessage";
import { areaInput, type EditorState } from "./useEditor";
import { makeCommand } from "./useAtlas";
import { bounds, rectangle } from "./presentation";
import { profiles, type World } from "./types";
import { ElevationFields } from "./FormFields";
import { DomainChoices, BoundarySummary } from "./DevelopmentPanel";

function useRefinement(world: World, editor: EditorState) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (form: FormData) => {
      if (!editor.selection) throw new Error("Draw an outline on the map first.");
      const input = {
        ...areaInput(editor.area, editor.selection, form),
        contextFeatureId: contextFeature(editor),
      };
      const result = await commitWorkspaceCommand(
        world.id,
        makeCommand(world, "createArea", input)
      );
      const area = Object.values(result.candidate.areas).find((area) => !world.areas[area.id])!;
      cache.setQueryData(["world", world.id], result.candidate);
      editor.enter(area.id);
      return { ...result, procedural: input.approach === "procedural" };
    },
    onSuccess: (result) => {
      editor.setSelection(null);
      editor.setPanel(result.procedural ? "configure-generation" : "generate");
      void cache.invalidateQueries({ queryKey: ["jobs", world.id] });
    },
  });
}
function contextFeature(editor: EditorState) {
  return editor.selected &&
    ["building", "settlement", "community", "cave"].includes(editor.selected.kind)
    ? editor.selected.id
    : null;
}
export function RefinementPanel({ world, editor }: { world: World; editor: EditorState }) {
  const create = useRefinement(world, editor),
    available = profiles
      .slice(profiles.indexOf(editor.area.profile) + 1)
      .filter((profile) => profile !== "region");
  const [profile, setProfile] = useState(
    editor.selected?.kind === "building" && available.includes("interior")
      ? "interior"
      : available[0]
  );
  if (!available.length)
    return (
      <p>
        This interior is ready for rooms, walls and doors. Choose Interior in the working layer
        menu.
      </p>
    );
  return (
    <section>
      <p className="eyebrow">LOCATE THE NEXT MAP</p>
      <h2>Locate another map</h2>
      <p>Outline a place, adjust its boundary, then choose how to develop it.</p>
      <div role="group" aria-label="Region outline tools">
        <button onClick={() => editor.setTool("refine")} aria-pressed={editor.tool === "refine"}>
          Drag a rectangle
        </button>
        <button
          onClick={() => editor.setTool("refinePolygon")}
          aria-pressed={editor.tool === "refinePolygon"}
        >
          Trace an outline
        </button>
      </div>
      <RegionPreview editor={editor} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(new FormData(event.currentTarget));
        }}
      >
        <label>
          Place name
          <input
            name="name"
            key={profile}
            defaultValue={`${editor.area.name} ${profile}`}
            required
          />
        </label>
        <label>
          Develop as
          <select
            name="profile"
            value={profile}
            onChange={(event) => setProfile(event.target.value as typeof profile)}
          >
            {available.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <RefinementApproach />
        <RefinementOptions editor={editor} profile={profile} />
        <BoundarySummary editor={editor} />
        <button className="primary" disabled={!editor.selection || create.isPending}>
          Create mapped area
        </button>
        <ErrorMessage error={create.error} />
      </form>
      <PreciseExtent editor={editor} />
    </section>
  );
}
function RefinementApproach() {
  return (
    <label>
      Starting point
      <select name="approach">
        <option value="manual">Inherited geography, edit by hand</option>
        <option value="procedural">Generate local detail</option>
        <option value="blank">Intentionally empty</option>
      </select>
    </label>
  );
}
function RefinementOptions({ editor, profile }: { editor: EditorState; profile: string }) {
  return (
    <details>
      <summary>Context, floor & generation systems</summary>
      <RefinementContext editor={editor} />
      <ElevationFields
        z={
          typeof editor.selected?.attributes.elevation === "number"
            ? editor.selected.attributes.elevation
            : editor.area.frame.origin.z
        }
      />
      <DomainChoices key={profile} profile={profile} />
    </details>
  );
}
function RegionPreview({ editor }: { editor: EditorState }) {
  if (!editor.selection)
    return (
      <p className="callout">
        Drag across the map, or trace an outline and double-click to finish. Hold Space to pan.
      </p>
    );
  const box = bounds(editor.selection),
    format = (value: number) =>
      value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${value.toFixed(1)} m`;
  return (
    <div className="callout">
      <p>
        Selected extent · {format(box[2] - box[0])} × {format(box[3] - box[1])}
      </p>
      <button onClick={() => editor.setTool("extentEdit")}>Adjust outline</button>
      <button
        className="quiet"
        onClick={() => {
          editor.setSelection(null);
          editor.setTool("refine");
        }}
      >
        Redraw extent
      </button>
    </div>
  );
}
function PreciseExtent({ editor }: { editor: EditorState }) {
  return (
    <details>
      <summary>Enter a precise extent</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          editor.selectExtent(
            rectangle(
              Number(data.get("x")),
              Number(data.get("y")),
              Number(data.get("width")),
              Number(data.get("height"))
            )
          );
        }}
      >
        <label>
          East · m
          <input
            name="x"
            type="number"
            step="any"
            defaultValue={editor.area.frame.origin.x}
            required
          />
        </label>
        <label>
          North · m
          <input
            name="y"
            type="number"
            step="any"
            defaultValue={editor.area.frame.origin.y}
            required
          />
        </label>
        <label>
          Width · m
          <input name="width" type="number" min=".01" step="any" defaultValue={1000} required />
        </label>
        <label>
          Height · m
          <input name="height" type="number" min=".01" step="any" defaultValue={1000} required />
        </label>
        <button>Use entered extent</button>
      </form>
    </details>
  );
}
function RefinementContext({ editor }: { editor: EditorState }) {
  const contexts: Record<string, string> = {
    building: "structure",
    community: "settlement",
    settlement: "settlement",
    cave: "cave",
  };
  return (
    <label>
      Context
      <select name="context" defaultValue={contexts[editor.selected?.kind ?? ""] ?? "landscape"}>
        <option value="landscape">Landscape</option>
        <option value="settlement">Settlement</option>
        <option value="structure">Structure</option>
        <option value="cave">Cave / underground</option>
      </select>
    </label>
  );
}
