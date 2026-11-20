import { useState } from "react";
import type { MapDescriptor, MapRegion } from "@atlas/map";
import type { PublishedRegionsState } from "./usePublishedRegions";
import type { PublishedNavigationState } from "./usePublishedNavigation";
import { ErrorMessage } from "./ErrorMessage";
import "./regions.css";

interface Props {
  map: MapDescriptor;
  regions: PublishedRegionsState;
  saved: PublishedNavigationState;
  refine(region: MapRegion): void;
  refineSelection(name?: string): void;
}
export function PublishedRegionsPanel(props: Props) {
  const { regions: state, saved } = props;
  return (
    <section className="regions-panel" aria-label="Map regions">
      <RegionList {...props} />
      <div className="region-selection-details">
        <p className="eyebrow">SELECTION PROPERTIES</p>
        {state.draft ? (
          <RegionDraft key={state.draft.id} {...props} />
        ) : state.region ? (
          <>
            <h2>{state.region.name}</h2>
            <SelectedRegion {...props} />
          </>
        ) : (
          <p>
            Under “Select a region by” in the toolbar, click a boundary, draw a polygon or draw
            freehand. Right-click a selection for actions.
          </p>
        )}
        <ErrorMessage error={state.error ?? saved.error} />
        {!!state.cuts.length && <button onClick={state.cancel}>Clear dividing lines</button>}
      </div>
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
// owner-direction(2026-11-17): clearly list all regions of the current map
function RegionList({ regions: state, map, saved }: Props) {
  return (
    <>
      <h3>
        Regions in {map.name} <small>({state.regions.length})</small>
      </h3>
      <nav aria-label="Region hierarchy" className="region-list">
        <button
          aria-current={state.id === null ? "location" : undefined}
          onClick={() => state.select(null)}
        >
          Entire map
        </button>
        <RegionBranches state={state} parentId={null} />
      </nav>
      {!saved.state && !saved.error && <p role="status">Loading regions…</p>}
      {saved.state && !state.regions.length && (
        <p className="hint">No regions chosen yet. Choose a region on the map to begin.</p>
      )}
    </>
  );
}
function RegionBranches({
  state,
  parentId,
}: {
  state: PublishedRegionsState;
  parentId: string | null;
}) {
  return (
    <ul>
      {state.regions
        .filter((region) => region.parentId === parentId)
        .map((region) => (
          <li key={region.id}>
            <button
              aria-current={state.id === region.id ? "location" : undefined}
              onClick={() => state.select(region.id)}
            >
              <span>{region.name}</span>
              <small>{region.child ? "Regional map available" : "Select region"}</small>
            </button>
            <RegionBranches state={state} parentId={region.id} />
          </li>
        ))}
    </ul>
  );
}
function RegionDraft({ regions, saved, map, refineSelection }: Props) {
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
      <p>Refine this selection, or keep it as a named region in {map.name}.</p>
      <p>{regions.area(draft.candidate.geometry)} km²</p>
      <p className="hint">
        Minimum useful width:{" "}
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
      <button type="button" disabled={saved.pending} onClick={() => refineSelection(name)}>
        Refine this selection
      </button>
      <button disabled={saved.pending}>Keep region</button>
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
