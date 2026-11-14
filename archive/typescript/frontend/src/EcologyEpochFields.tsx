import { defaultEcologyEpoch, type EcologyEpoch, type Epoch } from "@atlas/domain";

const settings: { key: keyof EcologyEpoch; label: string; max: number }[] = [
  { key: "rainfall", label: "Ecological rainfall · multiplier", max: 5 },
  { key: "seasonality", label: "Seasonal climate contrast · 0–1", max: 1 },
  { key: "productivity", label: "Ecological productivity · multiplier", max: 5 },
  { key: "fire", label: "Wildfire regime · multiplier", max: 5 },
  { key: "migration", label: "Dispersal and migration · multiplier", max: 5 },
  { key: "recovery", label: "Soil recovery and recycling · multiplier", max: 5 },
];
export function EcologyEpochFields({
  epoch,
  change,
}: {
  epoch: Epoch;
  change: (epoch: Epoch) => void;
}) {
  const ecology = { ...defaultEcologyEpoch, ...epoch.ecology };
  return (
    <details>
      <summary>Ecological regime</summary>
      <p className="hint">
        Climate, soil, surviving communities and migration routes determine the resulting biomes.
        Seasonal contrast changes winter survival and summer drought. These settings change
        ecological processes rather than prescribing forest or grassland coverage.
      </p>
      {settings.map(({ key, label, max }) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min="0"
            max={max}
            step="any"
            value={ecology[key]}
            onChange={(event) =>
              change({ ...epoch, ecology: { ...ecology, [key]: Number(event.target.value) } })
            }
          />
        </label>
      ))}
    </details>
  );
}
