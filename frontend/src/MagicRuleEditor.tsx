import {
  magicPhysicalFields,
  type MagicCondition,
  type MagicFeatureRule,
  type MagicSystem,
} from "@atlas/domain";

export function MagicRuleEditor({
  system,
  systems,
  change,
}: {
  system: MagicSystem;
  systems: MagicSystem[];
  change: (next: MagicSystem) => void;
}) {
  const update = (index: number, rule: MagicFeatureRule) =>
    change({
      ...system,
      features: system.features.map((current, i) => (i === index ? rule : current)),
    });
  return (
    <details>
      <summary>Landmarks & interactions</summary>
      <p>
        Grow each landmark from strong seed conditions through neighboring cells meeting retention
        conditions. All conditions in a group must hold; any group can qualify. Other systems can
        participate in the same rule. Intensity and climate fields use Canonry's 0–1,000 scale;
        elevation and slope use metres.
      </p>
      {system.features.map((rule, index) => (
        <FeatureRuleEditor
          key={rule.id}
          rule={rule}
          systems={systems}
          change={(updated) => update(index, updated)}
          remove={() =>
            change({ ...system, features: system.features.filter((_, i) => i !== index) })
          }
        />
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          change({
            ...system,
            features: [
              ...system.features,
              {
                id: crypto.randomUUID(),
                name: "New landmark",
                priority: 1,
                seeds: [[{ field: "intensity", min: 500 }]],
              },
            ],
          })
        }
      >
        Add landmark or interaction
      </button>
    </details>
  );
}
function FeatureRuleEditor({
  rule,
  systems,
  change,
  remove,
}: {
  rule: MagicFeatureRule;
  systems: MagicSystem[];
  change: (rule: MagicFeatureRule) => void;
  remove: () => void;
}) {
  return (
    <details>
      <summary>{rule.name}</summary>
      <label>
        Landmark name
        <input
          value={rule.name}
          onChange={(event) => change({ ...rule, name: event.target.value })}
        />
      </label>
      <label>
        Map surface priority
        <input
          type="number"
          value={rule.priority}
          onChange={(event) => change({ ...rule, priority: Number(event.target.value) })}
        />
      </label>
      <ConditionGroups
        label="Seed conditions"
        groups={rule.seeds}
        systems={systems}
        change={(seeds) => change({ ...rule, seeds })}
      />
      <ConditionGroups
        label="Retention conditions"
        groups={rule.retains ?? rule.seeds}
        systems={systems}
        change={(retains) => change({ ...rule, retains })}
      />
      <button type="button" className="quiet" onClick={remove}>
        Remove landmark rule
      </button>
    </details>
  );
}
function ConditionGroups({
  label,
  groups,
  systems,
  change,
}: {
  label: string;
  groups: MagicCondition[][];
  systems: MagicSystem[];
  change: (groups: MagicCondition[][]) => void;
}) {
  const update = (index: number, group: MagicCondition[]) =>
    change(groups.map((current, i) => (i === index ? group : current)));
  return (
    <fieldset>
      <legend>{label}</legend>
      {groups.map((group, index) => (
        <fieldset key={index}>
          <legend>Alternative {index + 1}</legend>
          {group.map((test, i) => (
            <ConditionInput
              key={i}
              test={test}
              systems={systems}
              change={(next) =>
                update(
                  index,
                  group.map((current, n) => (n === i ? next : current))
                )
              }
              remove={
                group.length > 1
                  ? () =>
                      update(
                        index,
                        group.filter((_, n) => n !== i)
                      )
                  : undefined
              }
            />
          ))}
          <button
            type="button"
            className="quiet"
            onClick={() => update(index, [...group, { field: "intensity", min: 500 }])}
          >
            Add condition
          </button>
          {groups.length > 1 && (
            <button
              type="button"
              className="quiet"
              onClick={() => change(groups.filter((_, n) => n !== index))}
            >
              Remove alternative
            </button>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        className="quiet"
        onClick={() => change([...groups, [{ field: "intensity", min: 500 }]])}
      >
        Add alternative
      </button>
    </fieldset>
  );
}
function ConditionInput({
  test,
  systems,
  change,
  remove,
}: {
  test: MagicCondition;
  systems: MagicSystem[];
  change: (test: MagicCondition) => void;
  remove?: () => void;
}) {
  return (
    <div>
      <label>
        Field
        <select
          value={test.field}
          onChange={(event) => change({ ...test, field: event.target.value })}
        >
          {magicPhysicalFields.map((field) => (
            <option key={field}>{field}</option>
          ))}
          {systems.map((system) => (
            <option key={system.id} value={`system:${system.id}`}>
              {system.name} intensity
            </option>
          ))}
        </select>
      </label>
      <label>
        At least
        <input
          type="number"
          step="any"
          value={test.min ?? ""}
          onChange={(event) => change(optionalCondition(test, "min", event.target.value))}
        />
      </label>
      <label>
        At most
        <input
          type="number"
          step="any"
          value={test.max ?? ""}
          onChange={(event) => change(optionalCondition(test, "max", event.target.value))}
        />
      </label>
      <label>
        One of these codes · comma separated
        <input
          value={test.values?.join(",") ?? ""}
          onChange={(event) => change(optionalCondition(test, "values", event.target.value))}
        />
      </label>
      {remove && (
        <button type="button" className="quiet" onClick={remove}>
          Remove condition
        </button>
      )}
    </div>
  );
}
function optionalCondition(test: MagicCondition, key: "min" | "max" | "values", value: string) {
  const next = { ...test };
  if (!value) delete next[key];
  else if (key === "values") next.values = value.split(",").map(Number);
  else next[key] = Number(value);
  return next;
}
