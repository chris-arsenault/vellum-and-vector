import type { AtlasFeature, World } from "./types";

export type Relationship = { targetId: string; kind: string };
export function RelationshipEditor({
  world,
  features,
  value,
  change,
}: {
  world: World;
  features: AtlasFeature[];
  value: Relationship[];
  change: (relations: Relationship[]) => void;
}) {
  const targets = [...Object.values(world.entities), ...features, ...Object.values(world.areas)];
  const options = [...new Map(targets.map((target) => [target.id, target])).values()];
  return (
    <fieldset>
      <legend>Relationships</legend>
      {value.map((relation, index) => (
        <div className="form-row" key={index}>
          <label>
            Relation
            <input
              list="relation-kinds"
              value={relation.kind}
              required
              onChange={(e) =>
                change(value.map((r, i) => (i === index ? { ...r, kind: e.target.value } : r)))
              }
            />
          </label>
          <label>
            Target
            <select
              value={relation.targetId}
              required
              onChange={(e) =>
                change(value.map((r, i) => (i === index ? { ...r, targetId: e.target.value } : r)))
              }
            >
              {!options.some((t) => t.id === relation.targetId) && (
                <option value={relation.targetId}>{relation.targetId || "Choose a target"}</option>
              )}
              {options.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="quiet"
            onClick={() => change(value.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <RelationKinds />
      <button
        type="button"
        className="quiet"
        onClick={() => change([...value, { kind: "owner", targetId: "" }])}
      >
        Add relationship
      </button>
    </fieldset>
  );
}
function RelationKinds() {
  const kinds = [
    "follows",
    "joins",
    "flowsInto",
    "connects",
    "entranceTo",
    "inside",
    "owner",
    "culture",
    "speaks",
    "practices",
    "administeredBy",
    "claimant",
    "capitalOf",
    "tradePartner",
    "rival",
  ];
  return (
    <datalist id="relation-kinds">
      {kinds.map((kind) => (
        <option key={kind}>{kind}</option>
      ))}
    </datalist>
  );
}
