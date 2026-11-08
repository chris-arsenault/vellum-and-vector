import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
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
const scale = MapScale.reference();

it("defaults to the coefficients the society code used as constants", () => {
  expect(defaultSocietyProfile(scale)).toEqual({
    culturalMobility: 1,
    politicalReach: 1,
    townThreshold: 5000,
    cityReach: 200_000,
    roadTraffic: 1000,
    marketTravel: 1,
    highways: 2,
  });
  // The atlas parameter defaults are the same values, so an untouched recipe binds them.
  expect(societyProfile(context({}, defaultAtlasParameters), scale)).toEqual(
    defaultSocietyProfile(scale)
  );
  expect(societyProfile(undefined, scale)).toEqual(defaultSocietyProfile(scale));
  for (const key of Object.keys(defaultSocietyProfile(scale)))
    expect(atlasParameterDefinitions[key as keyof typeof atlasParameterDefinitions].group).toBe(
      "human"
    );
});

it("reads a process's own parameters before the bound atlas parameters, in world units", () => {
  const profile = societyProfile(
    context({ cityReach: 0.075, highways: 4 }, { cityReach: 0.03, roadTraffic: 500, bogus: "x" }),
    scale
  );
  expect(profile).toMatchObject({ cityReach: 300_000, highways: 4, roadTraffic: 500 });
  expect(profile.marketTravel).toBe(1);
  const regional = societyProfile(
    context({ cityReach: 0.075 }),
    new MapScale(400_000, 300_000, 100)
  );
  expect(regional.cityReach).toBe(30_000);
  expect(regional.roadTraffic).toBe(
    profileOf({ physical: { map: { scale } } } as GenerationState).roadTraffic
  );
});

it("binds the profile to the workspace and falls back to defaults without one", () => {
  const state = { society: {}, physical: { map: { scale } } } as unknown as GenerationState;
  expect(profileOf(state)).toEqual(defaultSocietyProfile(scale));
  bindSocietyProfile(state, context({ townThreshold: 2500 }));
  expect(profileOf(state).townThreshold).toBe(2500);
  expect(profileOf({ physical: { map: { scale } } } as GenerationState)).toEqual(
    defaultSocietyProfile(scale)
  );
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
