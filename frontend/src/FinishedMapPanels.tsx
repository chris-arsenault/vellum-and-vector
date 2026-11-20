import { useQuery } from "@tanstack/react-query";
import type { MapDescriptor } from "@atlas/map";
import type { AtlasContext } from "@atlas/context";
import { ErrorMessage } from "./ErrorMessage";
import { readPublishedHistory } from "./publishedHistory";

type Context = Pick<AtlasContext<unknown>, "maps">;

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
