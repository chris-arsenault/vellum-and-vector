import type { PopulationGroup, SocietyCommunity, SocietyRegion, World } from "@atlas/domain";
import { Facts, Meter, Section, ShareBar } from "./InspectionSurface";
import { TrendChart } from "./TrendChart";
import { compact, percent } from "./surfaceData";
import {
  entityName,
  languageSegments,
  namingUseSegments,
  occupationSeries,
  population,
  practiceSegments,
  stepLabel,
} from "./settlementSurfaceData";

/** Each population group: its weight, what it does and what it speaks; then naming use. */
export function SettlementPeoples({
  world,
  community,
}: {
  world: World;
  community: SocietyCommunity;
}) {
  const people = Math.max(1, population(community));
  return (
    <Section title="Peoples" meta={`${community.groups.length} groups`}>
      {community.groups.map((group, i) => (
        <GroupCard key={i} world={world} group={group} people={people} />
      ))}
      <ShareBar
        label="Naming-language use"
        segments={namingUseSegments(world, community.groups)}
        format={(s) => percent(s.value, 1)}
      />
      {community.naming && (
        <Facts
          items={[
            ["Named", `${community.naming.era} in ${entityName(world, community.naming.language)}`],
          ]}
        />
      )}
    </Section>
  );
}
function GroupCard({
  world,
  group,
  people,
}: {
  world: World;
  group: PopulationGroup;
  people: number;
}) {
  const culture = group.culture ? entityName(world, group.culture) : group.people;
  return (
    <div className="group-card">
      <Meter
        label={`${culture}${group.religions.length ? ` · ${group.religions.map((id) => entityName(world, id)).join(", ")}` : ""}`}
        value={group.count}
        max={people}
        text={`${compact(group.count)} · ${percent(group.count / people)}`}
      />
      <ShareBar
        label={`Practices of ${culture}`}
        segments={practiceSegments(group)}
        total={1}
        format={(s) => percent(s.value)}
      />
      <ShareBar
        label={`Languages ${culture} know`}
        segments={languageSegments(world, group, "knowledge")}
        total={Math.max(1, ...languageSegments(world, group, "knowledge").map((s) => s.value))}
        format={(s) => percent(s.value, 1)}
      />
    </div>
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
