import { useQuery } from "@tanstack/react-query";
import type { MapDescriptor, MapRef } from "@atlas/map";
import type { AtlasContext } from "@atlas/context";
import { ErrorMessage } from "./ErrorMessage";
import { readPublishedHistory } from "./publishedHistory";

type Context = Pick<AtlasContext<unknown>, "maps" | "library">;

/** The links to a map's parent and its child maps. */
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
    queryFn: () => context.library.related(map.reference),
  });
  return (
    <nav className="breadcrumbs" aria-label="Map navigation">
      {related.data?.parent && (
        <button onClick={() => open(related.data!.parent!)}>Parent map</button>
      )}
      <span>{map.name}</span>
      {related.data?.children.map((child, i) => (
        <button key={child.mapId} onClick={() => open(child)}>
          Child map {i + 1}
        </button>
      ))}
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
