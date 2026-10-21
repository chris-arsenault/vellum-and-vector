import { useState } from "react";
import {
  defaultAtlasParameters,
  atlasParameterDefinitions,
  atlasPresets,
  type AtlasParameters,
  type AtlasParameterDefinition,
} from "@atlas/generation";

const settings = Object.entries(atlasParameterDefinitions).map(([key, value]) => {
  const definition: AtlasParameterDefinition = value;
  return { ...definition, key: key as keyof AtlasParameters };
});
/** A categorical setting is a choice; every other setting is a number. */
function SettingField({
  setting,
  value,
  change,
}: {
  setting: (typeof settings)[number];
  value: number;
  change(value: number): void;
}) {
  if (setting.choices)
    return (
      <label>
        {setting.label}
        <select
          name={setting.key}
          value={value}
          onChange={(event) => change(Number(event.target.value))}
        >
          {setting.choices.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label>
      {setting.label} · {setting.unit}
      <input
        name={setting.key}
        type="number"
        min={setting.exclusiveMinimum ? setting.step : setting.minimum}
        max={setting.maximum}
        step={setting.step}
        value={value}
        onChange={(event) => change(Number(event.target.value))}
      />
    </label>
  );
}
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
            setValues({
              ...defaultAtlasParameters,
              ...atlasPresets[event.target.value].parameters,
            });
          }}
        >
          {Object.entries(atlasPresets).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset.label}
            </option>
          ))}
          <option value="custom" disabled>
            Custom settings
          </option>
        </select>
      </label>
      <details>
        <summary>Land, climate, life & erosion controls</summary>
        {settings.map((setting) => (
          <SettingField
            key={setting.key}
            setting={setting}
            value={values[setting.key]}
            change={(value) => {
              setPreset("custom");
              setValues({ ...values, [setting.key]: value });
            }}
          />
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
