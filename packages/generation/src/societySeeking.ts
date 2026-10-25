import {
  communityPractices,
  livelihoodChannels,
  livelihoodShares,
  magicPracticeChannels,
  population,
  type PracticeShares,
  type SocietyCommunity,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { accessibleDive, magicAt } from "./societyMagicAccess";
import { nearestSample } from "./societySpatial";

/**
 * The shares steer seeking. A people weighs a destination by how far its own practices find
 * their medium there: the livelihoods the country yields and the magic the ground offers.
 * Fire people drift toward fracture, fishers along coasts, and a seat extends its reach over
 * the kind of country its people know how to hold. Nothing here decides what a people is.
 */

/** What a community's country offers each practice, 0..1 per channel. */
export function practiceOpportunity(state: GenerationState, c: SocietyCommunity): PracticeShares {
  const i = nearestSample(state, c.position),
    offered: PracticeShares = livelihoodShares(c.support);
  if (i < 0) return offered;
  const fire = magicAt(state, "quickens", i),
    aurora = magicAt(state, "stills", i);
  const dive = accessibleDive(state, c, 200),
    pressure = dive >= 0 ? magicAt(state, "moves-water", dive) : 0;
  for (const [id, value] of [
    ["fire-forge", fire],
    ["aurora-archive", aurora],
    ["pressure-diving", pressure],
  ] as const)
    if (value > 0) offered[id] = Math.min(1, value);
  return offered;
}
/** One read of every community's offer, for the cycle's migration and reach. */
export function practiceOpportunities(state: GenerationState) {
  return state.society!.region.communities.map((c) => practiceOpportunity(state, c));
}
const channels: readonly string[] = [...livelihoodChannels, ...magicPracticeChannels];
/**
 * How well a people's practices meet what a country offers, 0..1. A people with no practices
 * yet is indifferent, so every destination weighs the same as before it learned anything.
 */
export function practiceAffinity(seeker: PracticeShares, offered: PracticeShares) {
  let weight = 0,
    met = 0;
  for (const id of channels) {
    const share = seeker[id] ?? 0;
    if (share <= 0) continue;
    weight += share;
    met += share * (offered[id] ?? 0);
  }
  return weight > 0 ? met / weight : 0.5;
}
/** The factor seeking applies: half to one and a half, one for an indifferent people. */
export function seekingFactor(seeker: PracticeShares, offered: PracticeShares) {
  return 0.5 + practiceAffinity(seeker, offered);
}
/** Each community's practices by its people, read once for the cycle. */
export function seekerShares(communities: readonly SocietyCommunity[]) {
  return communities.map((c) => (population(c) > 0 ? communityPractices(c.groups) : {}));
}
