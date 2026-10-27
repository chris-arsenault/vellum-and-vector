import { expect, it } from "vitest";
import type { GenerationState, MapProcessContext } from "./process";
import {
  bindSocietyProfile,
  defaultSocietyProfile,
  profileOf,
  societyProfile,
} from "./societyProfile";
import { atlasParameterDefinitions, defaultAtlasParameters } from "./atlasParameters";
import { wayClass, wayClasses, wornCost } from "./societyWays";
import { isMajorRuin } from "./societyMapScope";

const context = (parameters: Record<string, unknown>, bound?: Record<string, unknown>) =>
  ({
    parameters,
    inputs: bound ? { parameters: bound } : undefined,
  }) as unknown as MapProcessContext;

it("defaults to the coefficients the society code used as constants", () => {
  expect(defaultSocietyProfile).toEqual({
    culturalMobility: 1,
    politicalReach: 1,
    townThreshold: 5000,
    cityReach: 200_000,
    roadTraffic: 1000,
    marketTravel: 1,
    highways: 2,
  });
  // The atlas parameter defaults are the same values, so an untouched recipe binds them.
  expect(societyProfile(context({}, defaultAtlasParameters))).toEqual(defaultSocietyProfile);
  expect(societyProfile(undefined)).toEqual(defaultSocietyProfile);
  for (const key of Object.keys(defaultSocietyProfile))
    expect(atlasParameterDefinitions[key as keyof typeof atlasParameterDefinitions].group).toBe(
      "human"
    );
});

it("reads a process's own parameters before the bound atlas parameters, in world units", () => {
  const profile = societyProfile(
    context({ cityReach: 300, highways: 4 }, { cityReach: 120, roadTraffic: 500, bogus: "x" })
  );
  expect(profile).toMatchObject({ cityReach: 300_000, highways: 4, roadTraffic: 500 });
  expect(profile.marketTravel).toBe(1);
});

it("binds the profile to the workspace and falls back to defaults without one", () => {
  const state = { society: {} } as unknown as GenerationState;
  expect(profileOf(state)).toEqual(defaultSocietyProfile);
  bindSocietyProfile(state, context({ townThreshold: 2500 }));
  expect(profileOf(state).townThreshold).toBe(2500);
  expect(profileOf({} as GenerationState)).toEqual(defaultSocietyProfile);
});

it("moves the way classes and the World town threshold with the profile", () => {
  const classes = wayClasses({ roadTraffic: 500 });
  expect(classes).toEqual({ track: 50, road: 500 });
  expect(wayClass({ wear: 60 }, classes)).toBe("track");
  expect(wayClass({ wear: 60 })).toBeNull();
  expect(wornCost({ distance: 1000, wear: 500, kind: "land" }, classes)).toBeCloseTo(600);
  const town = {
    founded: "Hearthfall, year 10",
    settlement: { population: 0, peak: 3000, recoveryYears: 0 },
  };
  expect(isMajorRuin(town)).toBe(false);
  expect(isMajorRuin(town, 2500)).toBe(true);
});
