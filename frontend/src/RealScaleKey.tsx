import { useQuery } from "@tanstack/react-query";
import { collectPages, type MapDescriptor, type MapReader } from "@atlas/map";
import { keyLayerIds, mapKey } from "./realScaleKey";

interface Props {
  map: MapDescriptor;
  reader: MapReader;
}
/** The numbered map key: each published place's number, name and account. */
export function RealScaleKey({ map, reader }: Props) {
  const key = useQuery({
    queryKey: ["real-scale-key", map.reference],
    queryFn: async ({ signal }) =>
      mapKey(
        await collectPages((cursor) =>
          reader.features(
            map.reference,
            { spaceId: map.primarySpaceId, layerIds: keyLayerIds(map), cursor },
            { signal }
          )
        )
      ),
  });
  return (
    <section aria-label="Map key">
      <h3>Map key</h3>
      {key.isPending && <p role="status">Reading the map key…</p>}
      {key.error && <p role="alert">{key.error.message}</p>}
      {key.data?.length === 0 && <p>No numbered places on this map.</p>}
      {!!key.data?.length && (
        <ol className="map-key">
          {key.data.map((entry) => (
            <li key={entry.id} value={entry.number}>
              <strong>{entry.name}</strong>
              {entry.account && <span> — {entry.account}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
