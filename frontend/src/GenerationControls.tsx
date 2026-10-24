import { useState } from "react";
import {
  defaultAtlasParameters,
  atlasParameterDefinitions,
  atlasPresets,
  type AtlasParameters,
  type AtlasParameterDefinition,
} from "@atlas/generation";
import type { Profile } from "@atlas/domain";
import { GenerationResolution } from "./GenerationResolution";

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
function DetailLevel({
  quality,
  profile,
  width,
  height,
}: {
  quality: string;
  profile: Profile;
  width: number;
  height: number;
}) {
  const [selected, setSelected] = useState(quality);
  return (
    <GenerationResolution
      width={width}
      height={height}
      quality={selected}
      profile={profile}
      change={setSelected}
    />
  );
}
export function GenerationControls({
  seed,
  initial,
  quality = "standard",
  profile,
  width,
  height,
}: {
  seed: number;
  initial?: Record<string, number>;
  quality?: string;
  profile: Profile;
  width: number;
  height: number;
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
      <DetailLevel quality={quality} profile={profile} width={width} height={height} />
      <label>
        Seed
        <input name="seed" type="number" defaultValue={seed} required />
      </label>
    </>
  );
}
