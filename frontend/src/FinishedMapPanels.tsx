import { useQuery } from "@tanstack/react-query";
import type { MapDescriptor, MapRef } from "@atlas/map";
import type { AtlasContext } from "@atlas/context";
import { ErrorMessage } from "./ErrorMessage";
import { readPublishedHistory } from "./publishedHistory";

type Context = Pick<AtlasContext<unknown>, "maps" | "library">;

/** Named child maps, independent of the current region selection. */
export function RelatedMaps({
  context,
  map,
  open,
}: {
  context: Context;
  map: MapDescriptor;
  open(reference: MapRef): void;
}) {
  const related = useQuery({
    queryKey: ["related-maps", map.reference],
    queryFn: async () => {
      const related = await context.library.related(map.reference);
      return Promise.all(related.children.map((child) => context.maps.open(child)));
    },
  });
  return (
    <nav className="region-list related-map-list" aria-label="Regional maps">
      <h3>Regional maps</h3>
      {related.isPending && <p role="status">Loading regional maps…</p>}
      {related.data?.map((child) => (
        <button key={child.reference.mapId} onClick={() => open(child.reference)}>
          <span>{child.name}</span>
          <small>Open map →</small>
        </button>
      ))}
      {related.data?.length === 0 && (
        <p className="hint">No regional maps created from this map.</p>
      )}
      <ErrorMessage error={related.error} />
    </nav>
  );
}
/** What the generation that made a map recorded doing. */
export function FinishedHistory({ context, map }: { context: Context; map: MapDescriptor }) {
  const history = useQuery({
    queryKey: ["map-history", map.reference],
    queryFn: ({ signal }) => readPublishedHistory(context.maps, map.reference, signal),
  });
  return (
    <section aria-label="Completed history">
      <h2>Completed history</h2>
      {history.data?.map((entry) => (
        <details key={entry.id}>
          <summary>{entry.title}</summary>
          <pre>{JSON.stringify(entry.attributes, null, 2)}</pre>
        </details>
      ))}
      <ErrorMessage error={history.error} />
    </section>
  );
}
