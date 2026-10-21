import {
  sameValue,
  type MagicSystem,
  type MagicFeatureRule,
  type MagicCondition,
} from "@atlas/domain";
import type { GenerationSettings } from "@atlas/generation";
import type { ConfigurationChange } from "./generationConfigurationChanges";

const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const lengthParameters = new Set([
  "sourceSpacing",
  "iceRetention",
  "coldRetentionDistance",
  "featureNoiseScale",
  "rayDistance",
  "coastalRayDistance",
  "wakeDistance",
  "beamWidth",
  "coastalSourceDistance",
]);
function parameterValue(key: string, value: number) {
  if (lengthParameters.has(key)) return `${value} m`;
  if (key === "accumulationArea") return `${value} m²`;
  return String(value);
}
function effectValue(key: keyof MagicSystem["effects"], value: number) {
  if (key === "heat") return `${value / 10} °C per intensity unit`;
  if (key === "iceMelt") return `${value} m per intensity unit`;
  if (key === "plantColdTolerance") return `${value} °C additional tolerance`;
  if (key === "coastalForcing") return `${value}×`;
  return String(value);
}

export function magicConfigurationChanges(
  current: GenerationSettings,
  previous: GenerationSettings
): ConfigurationChange[] {
  const changes = current.magicSystems.flatMap((system) =>
    systemChanges(
      system,
      previous.magicSystems.find((entry) => entry.id === system.id)
    )
  );
  const removed = previous.magicSystems.filter(
    (system) => !current.magicSystems.some((entry) => entry.id === system.id)
  );
  if (removed.length)
    changes.push({
      label: "Removed magical systems",
      value: removed.map((system) => system.name).join(", "),
    });
  for (const epoch of current.epochs) {
    const before = previous.epochs.find((entry) => entry.id === epoch.id);
    const values = current.magicSystems
      .filter(
        (system) =>
          (epoch.magicActivity?.[system.id] ?? 1) !== (before?.magicActivity?.[system.id] ?? 1)
      )
      .map((system) => `${system.name} ${epoch.magicActivity?.[system.id] ?? 1}×`);
    if (values.length)
      changes.push({ label: `${epoch.id} magical activity`, value: values.join("; ") });
  }
  return changes;
}

function systemChanges(system: MagicSystem, previous?: MagicSystem): ConfigurationChange[] {
  const values = systemHeaderChanges(system, previous);
  values.push(...systemNumericChanges(system, previous));
  appendHistoryChanges(values, system, previous);
  const changes: ConfigurationChange[] = values.length
    ? [{ label: system.name, value: values.join("; ") }]
    : [];
  return [...changes, ...ruleChanges(system, previous)];
}

const headerKeys = ["name", "enabled", "source", "propagation", "phase", "strength"] as const;
function systemHeaderChanges(system: MagicSystem, previous?: MagicSystem) {
  return headerKeys
    .filter((key) => system[key] !== previous?.[key])
    .map((key) => headerValue(system, key));
}
function headerValue(system: MagicSystem, key: (typeof headerKeys)[number]) {
  if (key === "enabled") return system.enabled ? "active" : "inactive";
  return `${key} ${system[key]}${key === "strength" ? "×" : ""}`;
}
function systemNumericChanges(system: MagicSystem, previous?: MagicSystem) {
  const values: string[] = [];
  for (const key of Object.keys(system.effects) as (keyof MagicSystem["effects"])[])
    if (system.effects[key] !== previous?.effects[key])
      values.push(`${words(key)} ${effectValue(key, system.effects[key])}`);
  for (const key of Object.keys(system.parameters) as (keyof MagicSystem["parameters"])[])
    if (system.parameters[key] !== previous?.parameters[key])
      values.push(`${words(key)} ${parameterValue(key, system.parameters[key])}`);
  return values;
}
function ruleChanges(system: MagicSystem, previous?: MagicSystem) {
  const changes: ConfigurationChange[] = [];
  for (const rule of system.features) {
    const before = previous?.features.find((entry) => entry.id === rule.id);
    if (!sameValue(rule, before))
      changes.push({ label: `${system.name} · ${rule.name}`, value: ruleValue(rule) });
  }
  const removed = previous?.features.filter(
    (rule) => !system.features.some((entry) => entry.id === rule.id)
  );
  if (removed?.length)
    changes.push({
      label: `${system.name} removed landmarks`,
      value: removed.map((rule) => rule.name).join(", "),
    });
  return changes;
}

function appendHistoryChanges(values: string[], system: MagicSystem, previous?: MagicSystem) {
  if (system.history.retention !== previous?.history.retention)
    values.push(`retained storage ${system.history.retention} fraction per epoch`);
  if (system.history.storage !== previous?.history.storage)
    values.push(`activity storage ${system.history.storage}× per epoch`);
  if (system.history.advect !== previous?.history.advect)
    values.push(system.history.advect ? "history moves with crust" : "history remains located");
}
function ruleValue(rule: MagicFeatureRule) {
  const alternatives = (groups: MagicCondition[][]) =>
    groups.length
      ? groups.map((group) => group.map(conditionValue).join(" and ")).join(" or ")
      : "none";
  return `priority ${rule.priority}; seed: ${alternatives(rule.seeds)}${rule.retains ? `; retain: ${alternatives(rule.retains)}` : "; retain: same as seed"}`;
}
function conditionValue(condition: MagicCondition) {
  const unit = ["elevation", "ice"].includes(condition.field) ? " m" : "";
  const values: string[] = [condition.field];
  if (condition.min !== undefined) values.push(`≥ ${condition.min}${unit}`);
  if (condition.max !== undefined) values.push(`≤ ${condition.max}${unit}`);
  if (condition.values !== undefined) values.push(`in [${condition.values.join(", ")}]`);
  if (condition.index !== undefined) values.push(`index ${condition.index}`);
  if (condition.salt !== undefined) values.push(`salt ${condition.salt}`);
  return values.join(" ");
}
