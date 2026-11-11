import type { AtlasFeature } from "@atlas/domain";
import { LinkList, Section, ShareBar } from "./InspectionSurface";
import { compact } from "./surfaceData";
import { placeWays, practiceLabel, recordedAt, waySegments } from "./settlementSurfaceData";
import type { FeatureSelector } from "./SettlementSurface";

/**
 * What the settlement built, what befell it and where its ways lead: the works and events
 * recorded at it and the ways that end at it, each a feature beside it on the map.
 */
interface TieProps {
  feature: AtlasFeature;
  related: AtlasFeature[];
  select: FeatureSelector;
}
export function SettlementTies(props: TieProps) {
  return (
    <>
      <WorksSection {...props} />
      <ReachSection {...props} />
      <EventsSection feature={props.feature} related={props.related} />
    </>
  );
}
function WorksSection({ feature, related, select }: TieProps) {
  const works = recordedAt(feature, related, false);
  return (
    <Section title="Works" meta={works.length ? `${works.length}` : undefined}>
      <LinkList
        empty="Nothing this map shows was built here."
        links={works.map((work) => ({
          id: work.id,
          label: work.name,
          channel: work.kind,
          meta:
            typeof work.attributes.built === "string" ? `raised ${work.attributes.built}` : null,
          select: select((f) => f.id === work.id),
        }))}
      />
    </Section>
  );
}
function ReachSection({ feature, related, select }: TieProps) {
  const ways = placeWays(feature, related);
  return (
    <Section title="Reach" meta={ways.length ? `${ways.length} ways` : undefined}>
      {ways.length > 0 && (
        <ShareBar
          label="Travellers by way"
          segments={waySegments(ways)}
          format={(s) => compact(s.value)}
        />
      )}
      <LinkList
        empty="No way leads from here to another place."
        links={ways.slice(0, 8).map(({ way, other, travellers }) => ({
          id: way.id,
          label: other?.name ?? way.name,
          channel: way.kind,
          meta: `${compact(travellers)} a year · ${practiceLabel(String(way.attributes.roadClass ?? way.kind))}`,
          select: select((f) => f.id === (other?.id ?? way.id)),
        }))}
      />
    </Section>
  );
}
function EventsSection({ feature, related }: Omit<TieProps, "select">) {
  const events = recordedAt(feature, related, true);
  if (!events.length) return null;
  return (
    <Section title="Events" collapsed>
      <table className="surface-table">
        <tbody>
          {events.map((event) => (
            <tr key={event.id} title={event.causes.join(" ")}>
              <td>{String(event.attributes.era ?? "")}</td>
              <td>{practiceLabel(String(event.attributes.eventKind ?? "event"))}</td>
              <td>{compact(Number(event.attributes.casualties ?? 0))} dead</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
