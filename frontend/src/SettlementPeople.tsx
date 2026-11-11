import type { AtlasFeature, PopulationGroup, World } from "@atlas/domain";
import { useState } from "react";
import { OverlapBars, Section, ShareBar } from "./InspectionSurface";
import { compact, percent } from "./surfaceData";
import {
  describedGroups,
  namingUseSegments,
  peoplesSegments,
  type PeoplesField,
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
 * Who lives here. A generated place states the share of its people who hold each tongue,
 * faith, custom and realm, read from the land it stands on. A place whose residents a creator
 * described is read across those groups instead.
 */
export function SettlementPeoples({ world, feature }: { world: World; feature: AtlasFeature }) {
  const groups = describedGroups(feature);
  return groups ? (
    <DescribedPeoples world={world} groups={groups} />
  ) : (
    <LandPeoples world={world} feature={feature} />
  );
}
const landKinds: [PeoplesField, string][] = [
  ["tongue", "Residents by tongue"],
  ["faith", "Residents by faith"],
  ["custom", "Residents by custom"],
  ["allegiance", "Residents by the realm they hold with"],
];
function LandPeoples({ world, feature }: { world: World; feature: AtlasFeature }) {
  const bars = landKinds
    .map(([field, label]) => ({ field, label, segments: peoplesSegments(world, feature, field) }))
    .filter((bar) => bar.segments.length > 0);
  if (!bars.length) return null;
  return (
    <Section title="Peoples">
      {bars.map((bar) => (
        <ShareBar
          key={bar.field}
          label={bar.label}
          segments={bar.segments}
          total={1}
          format={(s) => percent(s.value)}
          titled
        />
      ))}
    </Section>
  );
}
function DescribedPeoples({ world, groups }: { world: World; groups: PopulationGroup[] }) {
  const cultures = cultureSegments(world, groups);
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
