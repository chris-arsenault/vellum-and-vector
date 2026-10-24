import {
  magicPhysicalFields,
  type MagicCondition,
  type MagicFeatureRule,
  type MagicSystem,
} from "@atlas/domain";
import { CodeField, NumberField } from "./WorkflowFields";
import { useWorkflowFields } from "./workflowFieldState";

export function MagicRuleEditor({
  system,
  systems,
  change,
}: {
  system: MagicSystem;
  systems: MagicSystem[];
  change: (next: MagicSystem) => void;
}) {
  const { clear } = useWorkflowFields();
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
        elevation and ice use metres; slope is rise divided by run.
      </p>
      {system.features.map((rule, index) => (
        <FeatureRuleEditor
          key={rule.id}
          fieldKey={`magic.${system.id}.rules.${rule.id}`}
          rule={rule}
          systems={systems}
          change={(updated) => update(index, updated)}
          remove={() => {
            clear(`magic.${system.id}.rules.${rule.id}.`);
            change({ ...system, features: system.features.filter((_, i) => i !== index) });
          }}
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
  fieldKey,
  rule,
  systems,
  change,
  remove,
}: {
  fieldKey: string;
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
      <NumberField
        fieldKey={`${fieldKey}.priority`}
        label="Map surface priority"
        value={rule.priority}
        change={(priority) => change({ ...rule, priority })}
      />
      <label>
        Map representation
        <select
          value={rule.cartography ?? "area"}
          onChange={(e) =>
            change({ ...rule, cartography: e.target.value as MagicFeatureRule["cartography"] })
          }
        >
          <option value="site">Located site with surrounding extent</option>
          <option value="area">Classified area</option>
          <option value="course">Physical course where supported</option>
        </select>
      </label>
      <ConditionGroups
        fieldKey={`${fieldKey}.seeds`}
        label="Seed conditions"
        groups={rule.seeds}
        systems={systems}
        change={(seeds) => change({ ...rule, seeds })}
      />
      <ConditionGroups
        fieldKey={`${fieldKey}.retains`}
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
  fieldKey,
  label,
  groups,
  systems,
  change,
}: {
  fieldKey: string;
  label: string;
  groups: MagicCondition[][];
  systems: MagicSystem[];
  change: (groups: MagicCondition[][]) => void;
}) {
  const { removeIndex } = useWorkflowFields();
  const update = (index: number, group: MagicCondition[]) =>
    change(groups.map((current, i) => (i === index ? group : current)));
  const removeCondition = (group: number, index: number) => {
    removeIndex(`${fieldKey}.${group}`, index);
    update(
      group,
      groups[group].filter((_, i) => i !== index)
    );
  };
  return (
    <fieldset>
      <legend>{label}</legend>
      {groups.map((group, index) => (
        <fieldset key={index}>
          <legend>Alternative {index + 1}</legend>
          {group.map((test, i) => (
            <ConditionInput
              key={i}
              fieldKey={`${fieldKey}.${index}.${i}`}
              test={test}
              systems={systems}
              change={(next) =>
                update(
                  index,
                  group.map((current, n) => (n === i ? next : current))
                )
              }
              remove={group.length > 1 ? () => removeCondition(index, i) : undefined}
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
              onClick={() => {
                removeIndex(fieldKey, index);
                change(groups.filter((_, n) => n !== index));
              }}
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
  fieldKey,
  test,
  systems,
  change,
  remove,
}: {
  fieldKey: string;
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
          name={`${fieldKey}.field`}
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
      <NumberField
        fieldKey={`${fieldKey}.min`}
        label="At least"
        optional
        value={test.min}
        change={(min) => change(optionalBound(test, "min", min))}
      />
      <NumberField
        fieldKey={`${fieldKey}.max`}
        label="At most"
        optional
        value={test.max}
        change={(max) => change(optionalBound(test, "max", max))}
      />
      <CodeField
        fieldKey={`${fieldKey}.values`}
        label="One of these codes · comma separated"
        value={test.values}
        change={(values) => {
          const next = { ...test };
          if (values === undefined) delete next.values;
          else next.values = values;
          change(next);
        }}
      />
      {remove && (
        <button type="button" className="quiet" onClick={remove}>
          Remove condition
        </button>
      )}
    </div>
  );
}
function optionalBound(test: MagicCondition, key: "min" | "max", value: number | undefined) {
  const next = { ...test };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}
