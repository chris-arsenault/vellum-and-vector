import {
  languageShares,
  practiceShares,
  withLanguageShares,
  withPracticeShares,
  type PopulationGroup,
  type World,
} from "@atlas/domain";
import { useState } from "react";
import { SocietyLanguageEditor } from "./SocietyLanguageEditor";
import { groupRows } from "./settlementPeopleData";
import { compact, percent } from "./surfaceData";

/**
 * The groups as an index, heaviest first, with one group's fields open at a time. A
 * capital holds dozens of groups; stacking every group's fields made the form unusable.
 */
export function SocietyGroupEditor({
  world,
  groups,
  change,
}: {
  world: World;
  groups: PopulationGroup[];
  change: (groups: PopulationGroup[]) => void;
}) {
  const [opened, setOpened] = useState(0);
  const open = groups[opened] ? opened : 0;
  const update = (i: number, patch: Partial<PopulationGroup>) =>
    change(groups.map((g, j) => (i === j ? { ...g, ...patch } : g)));
  return (
    <fieldset>
      <legend>Population composition</legend>
      {groups.length > 1 && (
        <GroupIndex world={world} groups={groups} open={open} select={setOpened} />
      )}
      {groups[open] && (
        <GroupFields
          world={world}
          group={groups[open]}
          index={open}
          update={(patch) => update(open, patch)}
        />
      )}
      <button
        type="button"
        onClick={() => {
          change([...groups, emptyGroup(groups[0]?.people)]);
          setOpened(groups.length);
        }}
      >
        Add population group
      </button>
    </fieldset>
  );
}
function GroupIndex({
  world,
  groups,
  open,
  select,
}: {
  world: World;
  groups: PopulationGroup[];
  open: number;
  select: (index: number) => void;
}) {
  return (
    <div className="group-scroll">
      <table className="surface-table group-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Culture</th>
            <th>Traditions</th>
            <th className="num">People</th>
          </tr>
        </thead>
        <tbody>
          {groupRows(world, groups).map((row) => (
            <tr key={row.index} aria-current={row.index === open ? "true" : undefined}>
              <td>
                <button
                  type="button"
                  className="surface-link"
                  aria-label={`Edit group ${row.index + 1}`}
                  onClick={() => select(row.index)}
                >
                  <span className="surface-link-label">{row.index + 1}</span>
                </button>
              </td>
              <td>{row.culture}</td>
              <td>{row.traditions.length ? row.traditions.join(", ") : "—"}</td>
              <td className="num" title={percent(row.share, 1)}>
                {compact(row.count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function GroupFields({
  world,
  group,
  index,
  update,
}: {
  world: World;
  group: PopulationGroup;
  index: number;
  update: (patch: Partial<PopulationGroup>) => void;
}) {
  const entities = Object.values(world.entities);
  return (
    <div>
      <label>
        People in group {index + 1}
        <input
          type="number"
          min="0"
          step="any"
          value={group.count}
          onChange={(e) => update({ count: Number(e.target.value) })}
        />
      </label>
      <label>
        Culture
        <select
          value={group.culture ?? ""}
          onChange={(e) => update({ culture: e.target.value || null })}
        >
          <option value="">Unspecified</option>
          {entities
            .filter((e) => e.kind === "culture")
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </label>
      <Affiliations world={world} group={group} change={update} />
      <label>
        Practices (comma separated)
        <input
          value={group.practices.join(", ")}
          onChange={(e) =>
            update(
              practicePatch(
                group,
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            )
          }
        />
      </label>
    </div>
  );
}
function emptyGroup(people = "residents"): PopulationGroup {
  return { people, culture: null, languages: [], religions: [], practices: [], count: 0 };
}
/** A named practice keeps the share it had; a new one takes the equal share a list implies. */
function practicePatch(group: PopulationGroup, names: string[]): Partial<PopulationGroup> {
  const existing = practiceShares(group),
    equal = practiceShares({ practices: names });
  const { practices, practiceShares: shares } = withPracticeShares(
    group,
    Object.fromEntries(names.map((id) => [id, existing[id] ?? equal[id] ?? 1]))
  );
  return { practices, practiceShares: shares };
}
function Affiliations({
  world,
  group,
  change,
}: {
  world: World;
  group: PopulationGroup;
  change: (patch: Partial<PopulationGroup>) => void;
}) {
  return (
    <>
      {(["languages", "religions"] as const).map((key) => (
        <label key={key}>
          {key}
          <select
            multiple
            value={group[key]}
            onChange={(e) =>
              change(
                affiliationPatch(
                  group,
                  key,
                  Array.from(e.target.selectedOptions, (o) => o.value)
                )
              )
            }
          >
            {Object.values(world.entities)
              .filter((e) => e.kind === (key === "languages" ? "language" : "religion"))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
      ))}
      <SocietyLanguageEditor world={world} group={group} change={change} />
    </>
  );
}
function affiliationPatch(
  group: PopulationGroup,
  key: "languages" | "religions",
  values: string[]
): Partial<PopulationGroup> {
  if (key === "religions") return { religions: values };
  const shares = languageShares(group);
  return withLanguageShares(
    group,
    Object.fromEntries(values.map((id) => [id, shares[id] ?? { knowledge: 1, use: 0 }]))
  );
}
