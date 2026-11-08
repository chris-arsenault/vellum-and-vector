import type { MapScale } from "@atlas/domain";
import { mapScale } from "./worldSignificance";
import type { GenerationState, MapProcessContext } from "./process";
import { atlasParameterDefinitions } from "./atlasParameters";

/**
 * The society coefficients a creator's outcome choice moves, read once per cycle from the
 * generation's parameters into the workspace. Everything else in the society code stays a
 * constant: a coefficient becomes a setting only when a curated choice needs to move it.
 * Defaults are the values the code used before, so an untouched recipe generates the same
 * world.
 */
export interface SocietyProfile {
  /** Scales every era's cultural mobility: how far contact carries identities. */
  culturalMobility: number;
  /** Scales every era's political capacity: how far a seat's reach extends. */
  politicalReach: number;
  /** Concentrated residents that make a town, or the remains of one, a World feature. */
  townThreshold: number;
  /** Travel distance (m) over which a centre's draw on its hinterland falls by e. */
  cityReach: number;
  /** Yearly travellers that make a way a road; a track needs a tenth of them. */
  roadTraffic: number;
  /** Scales the market traffic between two towns. */
  marketTravel: number;
  /** Highways a polity keeps at one time. */
  highways: number;
}
const keys = [
  "culturalMobility",
  "politicalReach",
  "townThreshold",
  "cityReach",
  "roadTraffic",
  "marketTravel",
  "highways",
] as const;
export const defaultSocietyProfile = (scale: MapScale): SocietyProfile => ({
  culturalMobility: atlasParameterDefinitions.culturalMobility.default,
  politicalReach: atlasParameterDefinitions.politicalReach.default,
  townThreshold: atlasParameterDefinitions.townThreshold.default,
  cityReach: scale.length(atlasParameterDefinitions.cityReach.default),
  roadTraffic: atlasParameterDefinitions.roadTraffic.default,
  marketTravel: atlasParameterDefinitions.marketTravel.default,
  highways: atlasParameterDefinitions.highways.default,
});
/** The profile a process context carries: its own parameters first, the bound atlas parameters next. */
export function societyProfile(
  context: MapProcessContext | undefined,
  scale: MapScale
): SocietyProfile {
  const bound = (context?.inputs as { parameters?: Record<string, unknown> } | undefined)
    ?.parameters;
  const read = (key: (typeof keys)[number]) => {
    const value = context?.parameters?.[key] ?? bound?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const profile = defaultSocietyProfile(scale);
  for (const key of keys) {
    const value = read(key);
    if (value !== undefined) profile[key] = key === "cityReach" ? scale.length(value) : value;
  }
  return profile;
}
/** Bind the context's profile to the workspace so the cycle's processes read one set. */
export function bindSocietyProfile(state: GenerationState, context: MapProcessContext | undefined) {
  const profile = societyProfile(context, mapScale(state));
  if (state.society) state.society.profile = profile;
  return profile;
}
/** The workspace's profile, or the defaults where no human process has bound one. */
export function profileOf(state: GenerationState): SocietyProfile {
  return state.society?.profile ?? defaultSocietyProfile(mapScale(state));
}
