import { defaultEcologyEpoch, sameValue, type EcologyEpoch, type Epoch } from "@atlas/domain";
import type { GenerationSettings } from "@atlas/generation";

export interface ConfigurationChange {
  label: string;
  value: string;
}

const physicalFields: {
  key: keyof Omit<Epoch, "id" | "ecology" | "magicActivity">;
  label: string;
  unit: string;
}[] = [
  { key: "duration", label: "duration", unit: "years" },
  { key: "tectonics", label: "tectonic activity", unit: "×" },
  { key: "hydrology", label: "hydrological activity", unit: "×" },
  { key: "ice", label: "glacial activity", unit: "×" },
  { key: "coasts", label: "coastal activity", unit: "×" },
  { key: "temperature", label: "temperature shift", unit: "°C" },
  { key: "seaLevel", label: "sea level offset", unit: "m" },
  { key: "impacts", label: "impact activity", unit: "×" },
  { key: "volcanism", label: "volcanic activity", unit: "×" },
];
export function physicalChanges(current: Epoch[], previous: Epoch[]) {
  const changes: ConfigurationChange[] = [];
  if (
    !sameValue(
      current.map((epoch) => epoch.id),
      previous.map((epoch) => epoch.id)
    )
  )
    changes.push({
      label: "Epoch order and names",
      value: current.map((epoch) => epoch.id).join(" → "),
    });
  for (const epoch of current) {
    const before = previous.find((entry) => entry.id === epoch.id);
    const fields = physicalFields.filter(({ key }) => epoch[key] !== before?.[key]);
    const values = fields.map(
      ({ key, label, unit }) =>
        `${label} ${key === "temperature" ? epoch.temperature - 15 : epoch[key]} ${unit}`
    );
    if (values.length) changes.push({ label: epoch.id, value: values.join("; ") });
  }
  return changes;
}

const ecologyLabels: Record<keyof EcologyEpoch, string> = {
  rainfall: "rainfall",
  seasonality: "seasonal contrast",
  productivity: "productivity",
  fire: "wildfire regime",
  migration: "migration and dispersal",
  recovery: "soil recovery",
};
export function ecologyChanges(current: Epoch[], previous: Epoch[], only?: (keyof EcologyEpoch)[]) {
  const changes: ConfigurationChange[] = [];
  const keys = only ?? (Object.keys(ecologyLabels) as (keyof EcologyEpoch)[]);
  for (const epoch of current) {
    const before = previous.find((entry) => entry.id === epoch.id);
    const regime = { ...defaultEcologyEpoch, ...epoch.ecology };
    const changed = keys.filter((key) => regime[key] !== before?.ecology?.[key]);
    if (changed.length)
      changes.push({
        label: `${epoch.id} regime`,
        value: changed
          .map(
            (key) => `${ecologyLabels[key]} ${regime[key]} ${key === "seasonality" ? "(0–1)" : "×"}`
          )
          .join("; "),
      });
  }
  return changes;
}

export function culturalChanges(
  current: GenerationSettings["humanEras"],
  previous: GenerationSettings["humanEras"]
) {
  const changes: ConfigurationChange[] = [];
  if (
    !sameValue(
      current.map((era) => era.id),
      previous.map((era) => era.id)
    )
  )
    changes.push({
      label: "Cultural era order and names",
      value: current.map((era) => era.id).join(" → ") || "No elapsed cultural eras",
    });
  for (const era of current) {
    const before = previous.find((entry) => entry.id === era.id);
    const values = [];
    if (era.years !== before?.years) values.push(`duration ${era.years} years`);
    if (era.mobility !== before?.mobility) values.push(`mobility ${era.mobility}×`);
    if (values.length) changes.push({ label: era.id, value: values.join("; ") });
  }
  return changes;
}
