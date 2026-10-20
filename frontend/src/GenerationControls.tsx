import { useState } from "react";
import { defaultAtlasParameters, type AtlasParameters } from "@atlas/generation";

const settings: {
  key: keyof AtlasParameters;
  label: string;
  min: number;
  max?: number;
  step: number;
}[] = [
  { key: "continents", label: "Continental assemblies", min: 1, max: 30, step: 1 },
  { key: "provinces", label: "Tectonic provinces", min: 2, max: 200, step: 1 },
  { key: "landFraction", label: "Continental crust fraction", min: 0.05, max: 0.95, step: 0.01 },
  { key: "temperature", label: "Baseline temperature · °C", min: -50, max: 60, step: 0.5 },
  { key: "rainfall", label: "Rainfall · multiplier", min: 0, max: 5, step: 0.1 },
  { key: "erosion", label: "River erosion · multiplier", min: 0, max: 5, step: 0.1 },
  { key: "seaLevel", label: "Sea level adjustment · m", min: -5000, max: 5000, step: 10 },
  { key: "impacts", label: "Meteor impacts · history budget", min: 0, step: 1 },
  { key: "impactSize", label: "Crater radius · multiplier", min: 0.1, step: 0.1 },
  { key: "volcanism", label: "Volcanic construction · multiplier", min: 0, step: 0.1 },
  { key: "plateDrift", label: "Plate drift · multiplier", min: 0, step: 0.1 },
  { key: "glaciers", label: "Glacial erosion & deposition · multiplier", min: 0, step: 0.1 },
  { key: "coastalErosion", label: "Coastal erosion · multiplier", min: 0, step: 0.1 },
  { key: "vegetation", label: "Vegetation productivity · multiplier", min: 0, max: 5, step: 0.1 },
  { key: "grazing", label: "Herbivore pressure · multiplier", min: 0, max: 5, step: 0.1 },
  { key: "cultureCount", label: "Starting cultures", min: 1, step: 1 },
  { key: "polityCount", label: "Starting polities", min: 1, step: 1 },
];
const presets: Record<string, Partial<AtlasParameters>> = {
  balanced: {},
  islands: { continents: 12, landFraction: 0.25 },
  continental: { continents: 2, landFraction: 0.7 },
  cold: { temperature: -5 },
  arid: { rainfall: 0.2 },
  canonry: { continents: 5, provinces: 30, landFraction: 0.53, temperature: -17.5, impacts: 7 },
};
function DetailLevel({ quality, profile }: { quality: string; profile: string }) {
  const options =
    profile === "world"
      ? [
          "about 16,000 terrain samples",
          "about 65,000 terrain samples",
          "about 262,000 terrain samples",
        ]
      : ["coarse adaptive sampling", "medium adaptive sampling", "dense adaptive sampling"];
  return (
    <>
      <label>
        Detail level
        <select name="quality" defaultValue={quality}>
          {["Draft", "Standard", "Fine"].map((name, i) => (
            <option key={name} value={name.toLowerCase()}>
              {name} · {options[i]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Higher detail samples the same physical world more finely.{" "}
        {profile === "world" && "Sample counts include the surrounding simulation margin."}
      </p>
    </>
  );
}
export function GenerationControls({
  seed,
  initial,
  quality = "standard",
  profile,
}: {
  seed: number;
  initial?: Record<string, number>;
  quality?: string;
  profile: string;
}) {
  const [values, setValues] = useState({ ...defaultAtlasParameters, ...initial });
  const [preset, setPreset] = useState(initial ? "custom" : "balanced");
  return (
    <>
      <label>
        Landscape starting point
        <select
          value={preset}
          onChange={(event) => {
            setPreset(event.target.value);
            setValues({ ...defaultAtlasParameters, ...presets[event.target.value] });
          }}
        >
          <option value="balanced">Mixed continents</option>
          <option value="islands">Island world</option>
          <option value="continental">Broad continents</option>
          <option value="cold">Cold world</option>
          <option value="arid">Arid world</option>
          <option value="canonry">Ice Remembers · cold magical world</option>
          <option value="custom" disabled>
            Custom settings
          </option>
        </select>
      </label>
      <details>
        <summary>Land, climate, life & erosion controls</summary>
        {settings.map((setting) => (
          <label key={setting.key}>
            {setting.label}
            <input
              name={setting.key}
              type="number"
              min={setting.min}
              max={setting.max}
              step={setting.step}
              value={values[setting.key]}
              onChange={(event) => {
                setPreset("custom");
                setValues({ ...values, [setting.key]: Number(event.target.value) });
              }}
            />
          </label>
        ))}
        <p className="hint">
          These influence formation and erosion; land fraction describes starting crust, not a
          guaranteed final coastline. Local maps retain inherited boundaries. Starting counts apply
          when a region has no located cultures or polities; existing identities are retained.
          Vegetation and animals evolve over each physical epoch. Wetlands preserve organic matter;
          coal and oil source potential require burial, heat and geological time.
        </p>
      </details>
      <DetailLevel quality={quality} profile={profile} />
      <label>
        Seed
        <input name="seed" type="number" defaultValue={seed} required />
      </label>
    </>
  );
}
