import { expect, it } from "vitest";
import { domainCartography } from "./domainCartography";
import {
  applyCartographicSelection,
  controlFeatures,
  matchCartographicChoice,
  type CartographicControl,
} from "./cartographicControls";
import { atlasParameterDefinitions } from "./atlasParameters";
import { defaultHumanEras } from "./generationSettings";
import type { FeatureSelection } from "./features";

const people: CartographicControl[] = [
  ...domainCartography["human.cultures"],
  ...domainCartography["human.politics"],
  ...domainCartography["built.layout"],
];
/** The fields a control's choices own: setting keys and configuration keys per feature. */
function ownedFields(control: CartographicControl) {
  return new Set(
    control.choices.flatMap((choice) =>
      Object.entries(choice.features).flatMap(([id, patch]) => [
        ...Object.keys(patch.settings ?? {}).map((key) => `${id}.settings.${key}`),
        ...Object.keys(patch.configuration ?? {}).map((key) => `${id}.configuration.${key}`),
      ])
    )
  );
}

it("declares each people control over its own fields so one choice never unsets another", () => {
  expect(people.map((control) => control.id)).toEqual([
    "age",
    "cultural-pattern",
    "political-pattern",
    "towns",
    "roads",
  ]);
  for (const control of people) {
    expect(control.section).toBe("people");
    expect(control.choices.some((choice) => choice.id === control.defaultChoice)).toBe(true);
    for (const other of people)
      if (other !== control)
        for (const field of ownedFields(control)) expect(ownedFields(other).has(field)).toBe(false);
  }
});

it("reproduces the default world from the default choices", () => {
  let selection: FeatureSelection = {
    "human.cultures": { enabled: true },
    "human.politics": { enabled: true },
    "built.layout": { enabled: true },
  };
  for (const control of people)
    selection = applyCartographicSelection(
      selection,
      control.choices.find((choice) => choice.id === control.defaultChoice)!
    );
  for (const control of people)
    expect(matchCartographicChoice(control, selection)?.id, control.id).toBe(control.defaultChoice);
  // The default choices keep the starting counts the default world always had, and set every
  // society coefficient to the constant it replaced, so the default world is unchanged.
  expect(selection["human.cultures"].settings).toMatchObject({ cultureCount: 6 });
  expect(selection["human.politics"].settings).toMatchObject({ polityCount: 7 });
  for (const id of new Set(people.flatMap((control) => controlFeatures(control))))
    for (const [key, value] of Object.entries(selection[id].settings ?? {}))
      if (key !== "cultureCount" && key !== "polityCount")
        expect(value, `${id}.${key}`).toBe(
          atlasParameterDefinitions[key as keyof typeof atlasParameterDefinitions].default
        );
  expect(selection["human.cultures"].configuration!.eras).toEqual(schedule());
});

/** The default schedule as a choice states it: capacity stays with the imported setting. */
function schedule() {
  return defaultHumanEras().map(({ id, years, mobility, physicalEpoch }) => ({
    id,
    years,
    mobility,
    physicalEpoch,
  }));
}

it("ends the age in the chosen era and leaves the rounds before it", () => {
  const age = domainCartography["human.cultures"][0];
  const eras = (id: string) =>
    age.choices.find((choice) => choice.id === id)!.features["human.cultures"].configuration!
      .eras as { id: string; years: number; physicalEpoch: string | null }[];
  expect(eras("hearth").map((era) => era.id)).toEqual(["Ice age", "Hearthfall"]);
  expect(eras("crowns").map((era) => era.id)).toEqual(["Ice age", "Hearthfall", "Age of Crowns"]);
  expect(eras("lantern")).toEqual(schedule());
  const long = eras("long");
  expect(long.at(-1)!.years).toBe(2 * defaultHumanEras().at(-1)!.years);
  expect(long.slice(0, -1)).toEqual(schedule().slice(0, -1));
});
