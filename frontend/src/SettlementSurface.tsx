import type { AtlasFeature, SocietyCommunity, SocietyRegion, World } from "@atlas/domain";
import { useQuery } from "@tanstack/react-query";
import { atlasWorkspace, workspaceScope } from "./atlasWorkspace";
import type { EditorState } from "./useEditor";
import {
  Badge,
  Facts,
  LinkList,
  Meter,
  Section,
  ShareBar,
  Stat,
  StatGrid,
} from "./InspectionSurface";
import { compact, percent, shareSegments } from "./surfaceData";
import {
  entityName,
  population,
  practiceLabel,
  publishedCharacter,
  roleLabels,
  settlementCommunity,
  supportSegments,
} from "./settlementSurfaceData";
import { SettlementHistory, SettlementPeoples } from "./SettlementPeople";
import { SettlementMagic, SettlementTies } from "./SettlementTies";

/**
 * The settlement's surface: who lives here and on what, how that has gone, whose polity it
 * is, what magic it practises, what it built and whom it reaches. Every section reads the
 * retained society with mapped resident edits; the links select related features on the map.
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
  const retained = inspection.data;
  if (!retained) return null;
  const found = settlementCommunity(
    { ...world, societies: { [areaId]: retained.region } },
    feature,
    areaId
  );
  if (!found) return null;
  const { region, community } = found;
  const select = featureSelector(retained.related, editor);
  return (
    <>
      <TitleBadges feature={feature} community={community} />
      <PeopleSection community={community} />
      <SettlementPeoples world={world} community={community} />
      <SettlementHistory region={region} community={community} />
      <PolitySection world={world} feature={feature} region={region} select={select} />
      <SettlementMagic region={region} community={community} />
      <SettlementTies region={region} community={community} select={select} />
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
function TitleBadges({
  feature,
  community,
}: {
  feature: AtlasFeature;
  community: SocietyCommunity;
}) {
  const role = roleLabels[String(feature.attributes.settlementRole)];
  const site =
    typeof feature.attributes.siteReason === "string" ? feature.attributes.siteReason : null;
  return (
    <div className="surface-title">
      {role && <Badge tone="accent">{role}</Badge>}
      <Badge tone={statusTone[community.status]}>{community.status}</Badge>
      {feature.attributes.fortress === true && <Badge>Fortress</Badge>}
      {community.protected && <Badge>Protected</Badge>}
      {site && <span className="surface-meta">{site}</span>}
    </div>
  );
}

/** Residents against the room the country gives them, and where that room comes from. */
function PeopleSection({ community }: { community: SocietyCommunity }) {
  const people = population(community),
    urban = Math.min(people, community.settlement?.population ?? 0),
    capacity = community.support.capacity;
  return (
    <Section
      title="People"
      meta={`${Math.round(community.areaKm2).toLocaleString()} km² · founded ${community.founded}`}
    >
      <StatGrid>
        <Stat
          value={compact(urban)}
          label="settlement residents"
          hint={`${Math.round(urban).toLocaleString()} settlement residents`}
        />
        <Stat
          value={compact(people - urban)}
          label="rural residents"
          hint={`${Math.round(people - urban).toLocaleString()} rural residents`}
        />
        <Stat value={compact(people)} label="in all" />
      </StatGrid>
      <Meter
        label="Residents against local support"
        value={people}
        max={capacity}
        text={`${compact(people)} of ${compact(capacity)}`}
      />
      <ShareBar
        label="Local support by livelihood"
        segments={supportSegments(community)}
        format={(s) => compact(s.value)}
      />
      {community.settlement && community.settlement.peak > community.settlement.population && (
        <p className="surface-empty">
          Peak {compact(community.settlement.peak)} settlement residents; recovering for{" "}
          {Math.round(community.settlement.recoveryYears)} years.
        </p>
      )}
    </Section>
  );
}

/** The polity this settlement seats or answers to, with its published character. */
function PolitySection({
  world,
  feature,
  region,
  select,
}: {
  world: World;
  feature: AtlasFeature;
  region: SocietyRegion;
  select: FeatureSelector;
}) {
  const seats = Array.isArray(feature.attributes.capitalOf)
    ? (feature.attributes.capitalOf as string[])
    : [];
  const controller =
    typeof feature.attributes.polityId === "string" ? feature.attributes.polityId : null;
  if (!seats.length && !controller) return null;
  const polities = new Map(region.politics?.polities.map((p) => [p.id, p]) ?? []);
  return (
    <Section title="Polity">
      {seats.map((id) => (
        <PolityCharacter key={id} world={world} id={id} seat select={select} />
      ))}
      {controller && !seats.includes(controller) && (
        <LinkList
          links={[
            {
              id: controller,
              label: `Controlled by ${entityName(world, controller)}`,
              meta: polities.get(controller)?.status,
              select: select((f) => f.id === `control:${controller}`),
            },
          ]}
        />
      )}
    </Section>
  );
}
function PolityCharacter({
  world,
  id,
  seat,
  select,
}: {
  world: World;
  id: string;
  seat: boolean;
  select: FeatureSelector;
}) {
  const character = publishedCharacter(world, id);
  return (
    <div>
      <LinkList
        links={[
          {
            id,
            label: `${seat ? "Seat of" : ""} ${entityName(world, id)}`.trim(),
            meta: character ? `${character.communities} communities` : undefined,
            select: select((f) => f.id === `sovereignty:${id}`),
          },
        ]}
      />
      {character && (
        <>
          <ShareBar
            label={`${entityName(world, id)} character`}
            segments={shareSegments(character.practices, practiceLabel)}
            total={1}
            format={(s) => percent(s.value)}
          />
          <Facts
            items={[
              ["People", compact(character.people)],
              ["Languages", `${character.languages} widely known`],
            ]}
          />
        </>
      )}
    </div>
  );
}
