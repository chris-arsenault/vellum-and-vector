import type { SocietyCommunity, SocietyRegion, World } from "@atlas/domain";
import { useState } from "react";
import { Facts, OverlapBars, Section, ShareBar } from "./InspectionSurface";
import { TrendChart } from "./TrendChart";
import { compact, percent } from "./surfaceData";
import {
  entityName,
  namingUseSegments,
  occupationSeries,
  stepLabel,
} from "./settlementSurfaceData";
import {
  cultureSegments,
  foldGroupRows,
  groupRows,
  knowledgeSegments,
  residentPracticeSegments,
  traditionShares,
  type GroupRow,
} from "./settlementPeopleData";

/**
 * Who lives here, read across the population groups: by culture, by tradition, by
 * language and by livelihood. The groups themselves, which partition the residents by
 * people, culture and exact set of traditions, sit folded in a table underneath.
 */
export function SettlementPeoples({
  world,
  community,
}: {
  world: World;
  community: SocietyCommunity;
}) {
  const groups = community.groups,
    cultures = cultureSegments(world, groups);
  return (
    <Section
      title="Peoples"
      meta={`${groups.length} ${groups.length === 1 ? "group" : "groups"} · ${cultures.length} ${cultures.length === 1 ? "culture" : "cultures"}`}
    >
      <ShareBar label="Residents by culture" segments={cultures} titled />
      <OverlapBars label="Traditions residents hold" segments={traditionShares(world, groups)} />
      <ShareBar
        label="Naming-language use"
        segments={namingUseSegments(world, groups)}
        format={(s) => percent(s.value, 1)}
        titled
      />
      <OverlapBars
        label="Languages residents know"
        segments={knowledgeSegments(world, groups)}
        format={(s) => percent(s.value, 1)}
      />
      <ShareBar
        label="Livelihoods and crafts of residents"
        segments={residentPracticeSegments(groups)}
        total={1}
        format={(s) => percent(s.value)}
        titled
      />
      {community.naming && (
        <Facts
          items={[
            ["Named", `${community.naming.era} in ${entityName(world, community.naming.language)}`],
          ]}
        />
      )}
      <GroupTable rows={groupRows(world, groups)} />
    </Section>
  );
}

/** The groups heaviest first; those under a percent fold into one row until asked for. */
function GroupTable({ rows }: { rows: GroupRow[] }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const { shown, folded } = foldGroupRows(rows);
  const listed = all ? rows : shown;
  const foldedCount = folded.reduce((sum, row) => sum + row.count, 0),
    foldedShare = folded.reduce((sum, row) => sum + row.share, 0);
  return (
    <details>
      <summary>
        {rows.length} population {rows.length === 1 ? "group" : "groups"}
      </summary>
      <div className="group-scroll">
        <table className="surface-table group-table">
          <thead>
            <tr>
              <th>Culture</th>
              <th>Traditions</th>
              <th className="num">People</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((row) => (
              <tr key={row.index} title={`Group ${row.index + 1} of the record`}>
                <td>{row.culture}</td>
                <td>{row.traditions.length ? row.traditions.join(", ") : "—"}</td>
                <td className="num">{compact(row.count)}</td>
                <td className="num">{percent(row.share, row.share < 0.01 ? 2 : 1)}</td>
              </tr>
            ))}
            {folded.length > 0 && !all && (
              <tr>
                <td colSpan={2}>
                  <button type="button" className="surface-link" onClick={() => setAll(true)}>
                    <span className="surface-link-label">{folded.length} smaller groups</span>
                  </button>
                </td>
                <td className="num">{compact(foldedCount)}</td>
                <td className="num">{percent(foldedShare, 1)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Residents, support and the settlement over recorded steps, and the eras behind them. */
export function SettlementHistory({
  region,
  community,
}: {
  region: SocietyRegion;
  community: SocietyCommunity;
}) {
  const steps = community.history ?? [];
  return (
    <Section title="History" meta={steps.length ? `${steps.length} recorded steps` : undefined}>
      <TrendChart
        label="Population over recorded steps"
        series={occupationSeries(community)}
        xLabel={(x) => stepLabel(community, x)}
      />
      {steps.length > 0 && (
        <details>
          <summary>Local population history</summary>
          <table className="surface-table">
            <thead>
              <tr>
                <th>Era / year</th>
                <th>Residents</th>
                <th>Support</th>
                <th>Settlement</th>
                <th>Occupation</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, i) => (
                <tr key={i}>
                  <td>
                    {step.era} / {Math.round(step.year)}
                  </td>
                  <td>{Math.round(step.population).toLocaleString()}</td>
                  <td>{Math.round(step.capacity).toLocaleString()}</td>
                  <td>{Math.round(step.settlementPopulation).toLocaleString()}</td>
                  <td>{step.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <EraRecord region={region} />
    </Section>
  );
}
function EraRecord({ region }: { region: SocietyRegion }) {
  if (!region.history.length) return null;
  return (
    <details>
      <summary>Completed human eras</summary>
      <table className="surface-table">
        <thead>
          <tr>
            <th>Era</th>
            <th>Years</th>
            <th>Residents</th>
            <th>Migrated</th>
          </tr>
        </thead>
        <tbody>
          {region.history.map((era, i) => (
            <tr key={i} title={era.causes.join(" ")}>
              <td>{era.id}</td>
              <td>{Math.round(era.years)}</td>
              <td>
                {compact(era.before)} → {compact(era.after)}
              </td>
              <td>{compact(era.migrated)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
