import { useQuery } from "@tanstack/react-query";
import type { MapDescriptor, MapReader, PlaceRecord, SiteContext } from "@atlas/map";
import { ErrorMessage } from "./ErrorMessage";
import { formatDistance, type RealScalePresentation } from "./realScale";
import { isStructureMap } from "./structureMaps";

interface Props {
  map: MapDescriptor;
  reader: MapReader;
  units: RealScalePresentation["units"];
}
/** What a building's floors show of the world outside: magic prevalence at the site, the
 * magic features near it and the parent's place record, all read by the map store from the
 * parent's published GIS. */
export function RealScaleSite({ map, reader, units }: Props) {
  const site = useQuery({
    queryKey: ["structure-site", map.reference],
    enabled: isStructureMap(map),
    queryFn: ({ signal }) => reader.site(map.reference, { signal }),
  });
  if (!isStructureMap(map)) return null;
  return (
    <section aria-label="Outside this building" className="real-scale-site">
      <h3>Outside this building</h3>
      <ErrorMessage error={site.error} />
      {site.data && <SiteFacts site={site.data} units={units} />}
    </section>
  );
}
function SiteFacts({ site, units }: { site: SiteContext; units: Props["units"] }) {
  return (
    <>
      <h4>Magic prevalence</h4>
      {site.magic.length === 0 ? (
        <p>No magic is published at this site</p>
      ) : (
        <ul aria-label="Magic prevalence">
          {site.magic.map((share) => (
            <li key={share.system}>
              {share.label}: {Math.round(share.share * 100)}%
            </li>
          ))}
        </ul>
      )}
      <h4>Magic nearby</h4>
      {site.features.length === 0 ? (
        <p>No magic features nearby</p>
      ) : (
        <ul aria-label="Magic nearby">
          {site.features.map((feature) => (
            <li key={`${feature.mapId}|${feature.featureId}`}>
              {feature.name} · {formatDistance(feature.distance, units)}
            </li>
          ))}
        </ul>
      )}
      <Place place={site.place} />
    </>
  );
}
function Place({ place }: { place: PlaceRecord }) {
  const rows: [string, string | undefined | null][] = [
    ["Building", place.name],
    ["Use", place.use],
    ["Address", place.address],
    ["Street", place.street],
    ["Ward", place.ward],
    ["Settlement", place.settlement],
  ];
  return (
    <dl aria-label="Place">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd aria-label={label}>{value ?? "None"}</dd>
        </div>
      ))}
    </dl>
  );
}
