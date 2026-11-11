import type { AtlasFeature, World } from "@atlas/domain";
import { useQuery } from "@tanstack/react-query";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";
import type { EditorState } from "./useEditor";
import { Badge, LinkList, Section, ShareBar, Stat, StatGrid } from "./InspectionSurface";
import { compact } from "./surfaceData";
import {
  countryUseSegments,
  entityName,
  eraSeries,
  placeEras,
  placeFacts,
  realmTerritories,
  roleLabels,
} from "./settlementSurfaceData";
import { TrendChart } from "./TrendChart";
import { SettlementPeoples } from "./SettlementPeople";
import { SettlementTies } from "./SettlementTies";

/**
 * The settlement's surface: who lives here and on what country, how it came to be, whose
 * realm it holds with, what was built and what befell it, and where its ways lead. Every
 * section reads the settlement's own record and the features beside it on the map; the links
 * select those features.
 */
export function SettlementSurface({
  world,
  feature,
  areaId,
  editor,
}: {
  world: World;
  feature: AtlasFeature;
  areaId: string;
  editor: EditorState;
}) {
  const inspection = useQuery({
    queryKey: ["settlement", world.id, world.version, areaId, feature.id],
    queryFn: async () =>
      (await atlasWorkspace()).readSettlement(workspaceScope(world, areaId), feature.id),
  });
  if (inspection.isPending) return <p role="status">Reading settlement…</p>;
  if (inspection.error) return <p role="alert">{inspection.error.message}</p>;
  const related = inspection.data?.related ?? [],
    select = featureSelector(related, editor);
  return (
    <>
      <TitleBadges feature={feature} />
      <PeopleSection feature={feature} />
      <SettlementPeoples world={world} feature={feature} />
      <StorySection feature={feature} />
      <RealmSection world={world} feature={feature} related={related} select={select} />
      <SettlementTies feature={feature} related={related} select={select} />
    </>
  );
}

/** Select a feature by predicate, from the scene first and the world's record otherwise. */
export type FeatureSelector = (match: (f: AtlasFeature) => boolean) => (() => void) | undefined;
function featureSelector(related: AtlasFeature[], editor: EditorState): FeatureSelector {
  return (match) => {
    const feature = editor.scene.data?.find(match) ?? related.find(match) ?? null;
    return feature
      ? () => {
          if (feature.areaId !== editor.area.id) editor.enter(feature.areaId);
          editor.setSelected(feature);
        }
      : undefined;
  };
}

const statusTone = { inhabited: "good", abandoned: "warn", ruined: "bad" } as const;
function TitleBadges({ feature }: { feature: AtlasFeature }) {
  const role = roleLabels[String(feature.attributes.settlementRole)],
    { status } = placeFacts(feature);
  const site =
    typeof feature.attributes.siteReason === "string" ? feature.attributes.siteReason : null;
  return (
    <div className="surface-title">
      {role && <Badge tone="accent">{role}</Badge>}
      <Badge tone={statusTone[status]}>{status}</Badge>
      {feature.attributes.fortress === true && <Badge>Fortress</Badge>}
      {feature.protected && <Badge>Protected</Badge>}
      {site && <span className="surface-meta">{site}</span>}
    </div>
  );
}

/** Its townsfolk and the people of its country, and how that country is used. */
function PeopleSection({ feature }: { feature: AtlasFeature }) {
  const facts = placeFacts(feature),
    use = countryUseSegments(feature),
    meta = [
      facts.countryKm2 ? `${Math.round(facts.countryKm2).toLocaleString()} km² of country` : null,
      facts.founded ? `founded ${facts.founded}` : null,
    ].filter(Boolean);
  return (
    <Section title="People" meta={meta.join(" · ") || undefined}>
      <StatGrid>
        <Stat
          value={compact(facts.townsfolk)}
          label="settlement residents"
          hint={`${Math.round(facts.townsfolk).toLocaleString()} settlement residents`}
        />
        <Stat
          value={compact(facts.country)}
          label="rural residents"
          hint={`${Math.round(facts.country).toLocaleString()} rural residents`}
        />
        <Stat value={compact(facts.people)} label="in all" />
      </StatGrid>
      {use.length > 0 && (
        <ShareBar
          label="Its country by use"
          segments={use}
          format={(s) => `${compact(s.value)} km²`}
        />
      )}
      {facts.peak > facts.townsfolk && (
        <p className="surface-empty">Peak {compact(facts.peak)} settlement residents.</p>
      )}
    </Section>
  );
}

/** Its people over the eras it stood through; the record's causes are listed with every feature. */
function StorySection({ feature }: { feature: AtlasFeature }) {
  const eras = placeEras(feature);
  if (!eras.length) return null;
  return (
    <Section title="History" meta={`${eras.length} eras`}>
      <TrendChart
        label="People over its eras"
        series={eraSeries(eras)}
        xLabel={(x) => eras[Math.round(x)]?.era ?? ""}
      />
    </Section>
  );
}

/** The realm this settlement seats or holds with, and its territories on the map. */
function RealmSection({
  world,
  feature,
  related,
  select,
}: {
  world: World;
  feature: AtlasFeature;
  related: AtlasFeature[];
  select: FeatureSelector;
}) {
  const realm = typeof feature.attributes.polityId === "string" ? feature.attributes.polityId : "";
  if (!realm) return null;
  const seat = feature.attributes.settlementRole === "capital",
    territories = realmTerritories(feature, related),
    character = world.entities[realm]?.attributes.character as
      { people?: number; places?: number } | undefined;
  return (
    <Section
      title="Polity"
      meta={
        character
          ? `${compact(Number(character.people ?? 0))} people · ${Number(character.places ?? 0)} places`
          : undefined
      }
    >
      <LinkList
        links={[
          {
            id: realm,
            label: `${seat ? "Seat of" : "Holds with"} ${entityName(world, realm)}`,
            select: select(
              (f) => f.kind === "sovereignty" && territories.some((t) => t.id === f.id)
            ),
          },
          ...territories
            .filter((territory) => territory.kind !== "sovereignty")
            .map((territory) => ({
              id: territory.id,
              label: territory.name,
              meta: territory.kind,
              select: select((f) => f.id === territory.id),
            })),
        ]}
      />
    </Section>
  );
}
