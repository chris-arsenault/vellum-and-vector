import { useState } from "react";
import { v4 as uuid } from "uuid";
import type { MapDescriptor, MapView } from "@atlas/map";
import type { PublishedNavigationState } from "./usePublishedNavigation";
import type { PublishedPresentation } from "./PublishedMapView";
import { ErrorMessage } from "./ErrorMessage";

interface Props {
  map: MapDescriptor;
  saved: PublishedNavigationState;
  regionId: string | null;
  value: PublishedPresentation;
  open(view: MapView, presentation: PublishedPresentation): void;
}
export function PublishedMapViews({ map, saved, regionId, value, open }: Props) {
  const [name, setName] = useState("");
  const [selected, select] = useState<string | null>(null);
  const views = saved.state?.views ?? [];
  return (
    <section className="map-views">
      <h3>Saved views</h3>
      <p className="hint">
        Keep different compositions of the same geography. Use Save map to retain them across
        reloads.
      </p>
      <form
        className="save-map-view"
        onSubmit={(event) => {
          event.preventDefault();
          const id = uuid();
          void saved
            .commit({
              kind: "putView",
              data: {
                id,
                name: name.trim(),
                regionId,
                settings: JSON.parse(JSON.stringify(value)) as MapView["settings"],
              },
            })
            .then(() => select(id))
            .catch(() => {});
        }}
      >
        <label>
          View name
          <input
            value={name}
            required
            placeholder="e.g. Northern kingdoms"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button disabled={!name.trim() || !saved.state || saved.pending}>Save map view</button>
      </form>
      <ViewList
        map={map}
        saved={saved}
        views={views}
        selected={selected}
        open={(view) => {
          open(view, view.settings as unknown as PublishedPresentation);
          select(view.id);
        }}
      />
      <ErrorMessage error={saved.error} />
    </section>
  );
}
function ViewList({
  map,
  saved,
  views,
  selected,
  open,
}: Pick<Props, "map" | "saved"> & {
  views: MapView[];
  selected: string | null;
  open(view: MapView): void;
}) {
  return views.length ? (
    <ul className="saved-view-list">
      {views.map((view) => (
        <li key={view.id}>
          <div>
            <button
              className="quiet"
              aria-current={selected === view.id ? "true" : undefined}
              onClick={() => open(view)}
            >
              {view.name}
            </button>
            <small>
              {saved.state?.regions.find((region) => region.id === view.regionId)?.name ?? map.name}{" "}
              ·{" "}
              {view.settings.drawing && (view.settings.drawing as { mode: string }).mode === "drawn"
                ? "Drawn"
                : "Raster"}
            </small>
          </div>
          <button
            className="quiet"
            aria-label={`Remove ${view.name}`}
            disabled={saved.pending}
            onClick={() => void saved.commit({ kind: "removeView", data: view.id }).catch(() => {})}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p className="empty-views">No saved views yet.</p>
  );
}
