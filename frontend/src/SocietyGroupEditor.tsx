import {
  languageShares,
  withLanguageShares,
  type PopulationGroup,
  type World,
} from "@atlas/domain";
import { SocietyLanguageEditor } from "./SocietyLanguageEditor";
export function SocietyGroupEditor({
  world,
  groups,
  change,
}: {
  world: World;
  groups: PopulationGroup[];
  change: (groups: PopulationGroup[]) => void;
}) {
  const update = (i: number, patch: Partial<PopulationGroup>) =>
    change(groups.map((g, j) => (i === j ? { ...g, ...patch } : g)));
  const entities = Object.values(world.entities);
  return (
    <fieldset>
      <legend>Population composition</legend>
      {groups.map((g, i) => (
        <div key={i}>
          <label>
            People in group {i + 1}
            <input
              type="number"
              min="0"
              step="any"
              value={g.count}
              onChange={(e) => update(i, { count: Number(e.target.value) })}
            />
          </label>
          <label>
            Culture
            <select
              value={g.culture ?? ""}
              onChange={(e) => update(i, { culture: e.target.value || null })}
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
          <Affiliations world={world} group={g} change={(patch) => update(i, patch)} />
          <label>
            Practices (comma separated)
            <input
              value={g.practices.join(", ")}
              onChange={(e) =>
                update(i, {
                  practices: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
      ))}
      <button type="button" onClick={() => change([...groups, emptyGroup(groups[0]?.people)])}>
        Add population group
      </button>
    </fieldset>
  );
}
function emptyGroup(people = "residents"): PopulationGroup {
  return { people, culture: null, languages: [], religions: [], practices: [], count: 0 };
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
