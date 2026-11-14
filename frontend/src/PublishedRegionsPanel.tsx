import { useState } from "react";
import type { MapDescriptor, MapRegion } from "@atlas/map";
import type { PublishedRegionsState } from "./usePublishedRegions";
import type { PublishedNavigationState } from "./usePublishedNavigation";
import type { PublishedTool } from "./publishedInteractions";
import { ErrorMessage } from "./ErrorMessage";
import "./regions.css";

interface Props {
  map: MapDescriptor;
  regions: PublishedRegionsState;
  saved: PublishedNavigationState;
  tool: PublishedTool;
  setTool(tool: PublishedTool): void;
  refine(region: MapRegion): void;
}
export function PublishedRegionsPanel(props: Props) {
  const { map, regions: state, tool, saved } = props;
  const choosing = tool.startsWith("region-");
  return (
    <section className="regions-panel" aria-label="Map regions">
      <p className="eyebrow">{choosing ? "CHOOSE A REGION" : "SELECTED REGION"}</p>
      <h2>{state.region?.name ?? map.name}</h2>
      {!state.region && (
        <p>
          Choose the part of this map you want to explore. Selecting a region does not generate or
          change geography.
        </p>
      )}
      {state.region && !choosing && <SelectedRegion {...props} />}
      <RegionSelection {...props} />
      <ErrorMessage error={state.error ?? saved.error} />
      {!!state.cuts.length && <button onClick={state.cancel}>Clear dividing lines</button>}
      <RegionList {...props} />
    </section>
  );
}
function SelectedRegion(props: Props) {
  const region = props.regions.region!;
  return (
    <>
      <p>{props.regions.area(region.geometry)} km² · Showing existing map detail</p>
      <div className="selection-next">
        <h3>Add finer detail here</h3>
        <p>Create an independent map from this region’s captured geography.</p>
        <button
          className="primary"
          disabled={props.saved.pending}
          onClick={() => props.refine(region)}
        >
          Refine this region
        </button>
      </div>
      <RegionDetails key={`${region.id}:${region.name}`} {...props} />
    </>
  );
}
function RegionSelection(props: Props) {
  const { regions: state, tool, map, saved } = props;
  return state.draft && tool !== "region-pick" ? (
    <RegionDraft key={state.editingId ?? "new"} {...props} />
  ) : tool.startsWith("region-") ? (
    <RegionTools {...props} />
  ) : (
    <button disabled={!map.regionScale.enabled || !saved.state} onClick={state.begin}>
      {state.region ? "Choose a smaller region" : "Choose a region"}
    </button>
  );
}
function RegionList({ regions: state }: Props) {
  const children = state.regions.filter((region) => region.parentId === state.id);
  return (
    <>
      <h3>{state.region ? "Region navigation" : "Chosen regions"}</h3>
      <nav aria-label="Region hierarchy" className="region-list">
        {state.region && (
          <button onClick={() => state.enter(state.region!.parentId)}>↑ Parent region</button>
        )}
        {children.map((region) => (
          <button key={region.id} onClick={() => state.enter(region.id)}>
            {region.name}
            <small>
              {state.regions.filter((child) => child.parentId === region.id).length} subregions
              {region.child ? " · Open finer map" : ""}
            </small>
          </button>
        ))}
      </nav>
      {!children.length && <p className="hint">No smaller regions chosen here yet.</p>}
    </>
  );
}
function RegionTools({ regions, tool, setTool }: Props) {
  const tools: { tool: PublishedTool; name: string; detail: string }[] = [
    {
      tool: "region-pick",
      name: "Use an existing boundary",
      detail: "Pick a region enclosed by geography or territory.",
    },
    {
      tool: "region-outline",
      name: "Trace a custom outline",
      detail: "Choose an area without an existing boundary.",
    },
    {
      tool: "region-cut",
      name: "Divide along a line",
      detail: "Combine your line with rivers, shores or the current boundary.",
    },
  ];
  return (
    <>
      <div className="region-tool-options" role="group" aria-label="Region tools">
        {tools.map((choice) => (
          <button
            key={choice.tool}
            aria-label={choice.name}
            aria-pressed={tool === choice.tool}
            onClick={() => setTool(choice.tool)}
          >
            <strong>{choice.name}</strong>
            <small>{choice.detail}</small>
          </button>
        ))}
      </div>
      <p role="status">
        {regions.cuts.length
          ? "Click the side of the dividing line you want to keep."
          : "Choose a boundary or draw an outline. Double-click to finish drawing."}{" "}
        Press Escape to cancel.
      </p>
      <button className="quiet" onClick={regions.cancel}>
        Cancel region selection
      </button>
    </>
  );
}
function RegionDraft({ regions, saved, map, tool, setTool }: Props) {
  const draft = regions.draft!;
  const [name, setName] = useState(draft.candidate.name === "Region" ? "" : draft.candidate.name);
  return (
    <form
      className="region-draft"
      onSubmit={(event) => {
        event.preventDefault();
        void regions.save(name).catch(() => {});
      }}
    >
      <h3>Selected outline</h3>
      <p>
        {regions.editingId
          ? "Keeping this outline updates the same region."
          : `Keep this outline as a region within ${regions.region?.name ?? map.name}.`}
      </p>
      <p>{regions.area(draft.candidate.geometry)} km²</p>
      <p className="hint">
        Drag outline vertices to adjust the boundary. Minimum useful width:{" "}
        {(
          map.regionScale.minimumWidth *
          map.spaces.find((space) => space.id === map.primarySpaceId)!.metresPerUnit
        ).toLocaleString()}{" "}
        m.
      </p>
      {draft.candidates.length > 1 && (
        <label>
          Boundary choice
          <select
            aria-label="Boundary choice"
            value={draft.candidates.indexOf(draft.candidate)}
            onChange={(event) => regions.choose(draft.candidates[Number(event.target.value)])}
          >
            {draft.candidates.map((candidate, index) => (
              <option key={index} value={index}>
                {candidate.name} · {regions.area(candidate.geometry)} km²
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Region name <small>optional</small>
        <input
          aria-label="Region name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <button className="primary" disabled={saved.pending}>
        Keep region
      </button>
      {tool !== "region-edit" && (
        <button type="button" onClick={() => setTool("region-edit")}>
          Adjust selected outline
        </button>
      )}
      <button type="button" onClick={regions.cancel}>
        Discard outline
      </button>
    </form>
  );
}
function RegionDetails({ regions, saved }: Props) {
  const region = regions.region!;
  const [name, setName] = useState(region.name);
  const attached =
    region.child ||
    regions.regions.some((child) => child.parentId === region.id) ||
    saved.state?.views.some((view) => view.regionId === region.id);
  return (
    <details>
      <summary>Region details</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void regions.rename(name).catch(() => {});
        }}
      >
        <label>
          Rename region
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button disabled={!name.trim() || saved.pending}>Rename</button>
      </form>
      <button disabled={!!region.child} onClick={regions.adjust}>
        Adjust outline
      </button>
      {region.child && (
        <p className="hint">
          A finer map uses this outline. Choose a new region for a different extent.
        </p>
      )}
      <button
        disabled={!!attached || saved.pending}
        onClick={() => void regions.remove().catch(() => {})}
      >
        Remove region
      </button>
      {attached && (
        <p className="hint">Retained by a finer map, child regions or saved map views.</p>
      )}
    </details>
  );
}
