import type { SocietyCommunity, SocietyMagicPractice, SocietyRegion } from "@atlas/domain";
import { Badge, LinkList, Meter, Section, ShareBar, Stat, StatGrid } from "./InspectionSurface";
import { compact, percent } from "./surfaceData";
import {
  communityEvents,
  communityNeighbours,
  communityWorks,
  connectionSegments,
  practiceLabel,
} from "./settlementSurfaceData";
import type { FeatureSelector } from "./SettlementSurface";

/** What the community's magic ledger shows: stock, use and the strain of each practice. */
export function SettlementMagic({
  region,
  community,
}: {
  region: SocietyRegion;
  community: SocietyCommunity;
}) {
  const ledger = region.magic.find((p) => p.communityId === community.id);
  if (!ledger || !practised(ledger)) return null;
  return (
    <Section title="Magic">
      <FireMeters ledger={ledger} />
      <AuroraMeters ledger={ledger} />
      <StatGrid>
        {ledger.coreUsed > 0 && <Stat value={ledger.coreUsed.toFixed(1)} label="cores consumed" />}
        {ledger.crystals > 0 && <Stat value={ledger.crystals.toFixed(1)} label="crystals" />}
        {ledger.readers > 0 && <Stat value={compact(ledger.readers)} label="readers" />}
        {ledger.divers > 0 && <Stat value={compact(ledger.divers)} label="divers" />}
        {ledger.divers > 0 && <Stat value={`${ledger.depthLimit} m`} label="depth limit" />}
        {ledger.injuries > 0 && <Stat value={compact(ledger.injuries)} label="diving injuries" />}
      </StatGrid>
    </Section>
  );
}
function practised(p: SocietyMagicPractice) {
  return (
    p.coreSupply + p.coreDeposit + p.coreUsed + p.heatApplied > 0 ||
    p.crystals + p.readers + p.memoryAccess > 0 ||
    p.divers + p.pressureUsed > 0
  );
}
function FireMeters({ ledger }: { ledger: SocietyMagicPractice }) {
  const cores = ledger.coreSupply + ledger.coreDeposit;
  if (cores + ledger.coreUsed + ledger.heatApplied <= 0) return null;
  return (
    <>
      <Meter
        label="Fire cores stored"
        value={ledger.coreSupply}
        max={cores}
        text={`${ledger.coreSupply.toFixed(1)} of ${cores.toFixed(1)}`}
        channel="fire-forge"
      />
      <Meter
        label="Forge heat applied"
        value={ledger.heatApplied}
        max={8}
        text={ledger.heatApplied.toFixed(2)}
        channel="fire-forge"
      />
    </>
  );
}
function AuroraMeters({ ledger }: { ledger: SocietyMagicPractice }) {
  if (ledger.crystals + ledger.readers + ledger.memoryAccess <= 0) return null;
  return (
    <>
      <Meter
        label="Archive memory access"
        value={ledger.memoryAccess}
        max={1}
        channel="aurora-archive"
      />
      <Meter
        label="Archive strain"
        value={ledger.strain}
        max={1}
        text={ledger.strain.toFixed(2)}
        channel="aurora-archive"
      />
    </>
  );
}

/** Works the community made or demands, the neighbours it reaches, and what befell it. */
export function SettlementTies({
  region,
  community,
  select,
}: {
  region: SocietyRegion;
  community: SocietyCommunity;
  select: FeatureSelector;
}) {
  return (
    <>
      <WorksSection region={region} community={community} select={select} />
      <ReachSection region={region} community={community} select={select} />
      <EventsSection region={region} community={community} />
    </>
  );
}
interface TieProps {
  region: SocietyRegion;
  community: SocietyCommunity;
  select: FeatureSelector;
}
function WorksSection({ region, community, select }: TieProps) {
  const works = communityWorks(region, community.id);
  return (
    <Section title="Works" meta={works.length ? `${works.length}` : undefined}>
      <LinkList
        empty="Nothing built or demanded here."
        links={works.map((w) => ({
          id: w.id,
          label: w.name ?? practiceLabel(w.kind),
          channel: w.kind,
          meta: w.demand ? (
            <Badge tone="warn">demand</Badge>
          ) : (
            <>
              {percent(w.condition)} {w.maintained ? "kept" : "unkept"}
            </>
          ),
          select: select((f) => f.id === `work:${w.id}` || f.id === w.id),
        }))}
      />
    </Section>
  );
}
function ReachSection({ region, community, select }: TieProps) {
  const neighbours = communityNeighbours(region, community.id);
  return (
    <Section
      title="Reach"
      meta={neighbours.length ? `${neighbours.length} connections` : undefined}
    >
      {neighbours.length > 0 && (
        <ShareBar
          label="Connections by way"
          segments={connectionSegments(neighbours)}
          format={(s) => String(s.value)}
        />
      )}
      <LinkList
        empty="No connection to another community."
        links={neighbours.slice(0, 8).map(({ link, neighbour }) => ({
          id: neighbour.id,
          label: neighbour.name,
          channel: link.kind,
          meta: `${compact(link.distance / 1000)} km · ${link.kind}`,
          select: select(
            (f) => f.kind === "settlement" && f.attributes.communityId === neighbour.id
          ),
        }))}
      />
    </Section>
  );
}
function EventsSection({ region, community }: Omit<TieProps, "select">) {
  const events = communityEvents(region, community.id);
  if (!events.length) return null;
  return (
    <Section title="Events" collapsed>
      <table className="surface-table">
        <tbody>
          {events.map((e) => (
            <tr key={e.id} title={e.causes.join(" ")}>
              <td>{e.era}</td>
              <td>{practiceLabel(e.kind)}</td>
              <td>{compact(e.casualties)} dead</td>
              <td>{compact(e.displaced)} displaced</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
