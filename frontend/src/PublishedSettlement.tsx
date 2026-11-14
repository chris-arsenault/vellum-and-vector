import type { MapDescriptor, MapEntity, MapReader } from "@atlas/map";
import { useQuery } from "@tanstack/react-query";
import { SettlementDetails, type FeatureSelector } from "./SettlementDetails";
import { publishedFeature, type PublishedFeature } from "./publishedAppearance";
import { settlementEntityIds } from "./settlementSurfaceData";

export function PublishedSettlement({
  map,
  reader,
  feature,
  select,
}: {
  map: MapDescriptor;
  reader: MapReader;
  feature: PublishedFeature;
  select: (feature: PublishedFeature) => void;
}) {
  const inspection = useQuery({
    queryKey: ["map-settlement", map.reference, feature.id],
    queryFn: async ({ signal }) => {
      const [settlement, entities] = await Promise.all([
        reader.settlement(map.reference, feature.id, { signal }),
        reader.entities(map.reference, settlementEntityIds(feature), { signal }),
      ]);
      return { related: (settlement?.related ?? []).map(publishedFeature), entities };
    },
  });
  if (inspection.isPending) return <p role="status">Reading settlement…</p>;
  if (inspection.error) return <p role="alert">{inspection.error.message}</p>;
  const { related, entities } = inspection.data;
  const names = Object.fromEntries(entities.map((entity) => [entity.id, entity]));
  const selectRelated: FeatureSelector = (match) => {
    const found = related.find(match);
    return found ? () => select(found) : undefined;
  };
  return (
    <SettlementDetails
      names={names}
      feature={feature}
      related={related}
      select={selectRelated}
      protected={feature.catalog.values.protected === true}
      realm={realmPopulation(names[String(feature.attributes.polityId ?? "")])}
    />
  );
}
function realmPopulation(entity: MapEntity | undefined) {
  return entity && (entity.people !== null || entity.places !== null)
    ? { people: entity.people ?? 0, places: entity.places ?? 0 }
    : undefined;
}
