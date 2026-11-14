import {
  languageShares,
  primaryNamingLanguage,
  withLanguageShares,
  type PopulationGroup,
  type World,
} from "@atlas/domain";

export function SocietyLanguageEditor({
  world,
  group,
  change,
}: {
  world: World;
  group: PopulationGroup;
  change: (patch: Partial<PopulationGroup>) => void;
}) {
  const shares = languageShares(group);
  const mixed = Object.values(shares).filter((s) => s.use > 0).length > 1;
  return (
    <>
      <label>
        Naming language
        <select
          value={mixed ? "mixed" : (primaryNamingLanguage(group) ?? "")}
          onChange={(e) =>
            change(
              withLanguageShares(
                group,
                Object.fromEntries(
                  Object.entries(shares).map(([id, s]) => [
                    id,
                    {
                      knowledge: id === e.target.value ? 1 : s.knowledge,
                      use: Number(id === e.target.value),
                    },
                  ])
                )
              )
            )
          }
        >
          {mixed && (
            <option value="mixed" disabled>
              Mixed use — edit shares below
            </option>
          )}
          <option value="">Unspecified</option>
          {group.languages.map((id) => (
            <option key={id} value={id}>
              {world.entities[id]?.name ?? id}
            </option>
          ))}
        </select>
      </label>
      <p>
        Knowledge can overlap. Naming-use shares total at most 100%; the remainder is unspecified.
      </p>
      {Object.entries(shares).map(([id, share]) => (
        <fieldset key={id}>
          <legend>{world.entities[id]?.name ?? id}</legend>
          {(["knowledge", "use"] as const).map((channel) => (
            <label key={channel}>
              {channel === "knowledge" ? "Know" : "Naming use"} {world.entities[id]?.name ?? id} (%)
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={Number((share[channel] * 100).toFixed(6))}
                onChange={(e) =>
                  change(editShare(group, id, channel, Number(e.target.value) / 100))
                }
              />
            </label>
          ))}
        </fieldset>
      ))}
    </>
  );
}
function editShare(
  group: PopulationGroup,
  id: string,
  channel: "knowledge" | "use",
  value: number
) {
  const shares = structuredClone(languageShares(group));
  value = Math.max(0, Math.min(1, value));
  if (channel === "knowledge")
    shares[id] = { knowledge: value, use: Math.min(value, shares[id].use) };
  else {
    const otherUse = Object.entries(shares).reduce(
      (sum, [key, s]) => sum + (key === id ? 0 : s.use),
      0
    );
    const factor = otherUse > 1 - value ? (1 - value) / otherUse : 1;
    for (const [key, s] of Object.entries(shares)) if (key !== id) s.use *= factor;
    shares[id] = { knowledge: Math.max(value, shares[id].knowledge), use: value };
  }
  return withLanguageShares(group, shares);
}
