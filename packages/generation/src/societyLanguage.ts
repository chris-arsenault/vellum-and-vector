import {
  languageUse,
  population,
  languageShares,
  withLanguageShares,
  type PopulationGroup,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { contactCosts } from "./societyContact";

interface Contact {
  language: string;
  weight: number;
}
function contacts(state: GenerationState) {
  const region = state.society!.region;
  const indices = new Map(region.communities.map((c, i) => [c.id, i]));
  const mixes = region.communities.map((c) => languageUse(c.groups));
  const exposures: Contact[][] = region.communities.map(() => []);
  const cost = contactCosts(region);
  for (const link of region.connections) {
    const a = indices.get(link.from)!,
      b = indices.get(link.to)!;
    if (population(region.communities[a]) < 1 || population(region.communities[b]) < 1) continue;
    const strength = Math.exp(-cost(link) / 150000);
    for (const [target, source] of [
      [a, b],
      [b, a],
    ])
      for (const [language, share] of Object.entries(mixes[source]))
        exposures[target].push({ language, weight: strength * share });
  }
  return exposures;
}
function adoptUse(groups: PopulationGroup[], exposure: Contact[], years: number, mobility: number) {
  const weights = new Map<string, number>();
  for (const { language, weight } of exposure)
    weights.set(language, (weights.get(language) ?? 0) + weight);
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return groups;
  const fraction = -Math.expm1((-years * mobility * total) / 400);
  if (fraction === 0) return groups;
  return groups.map((group) => {
    const previous = languageShares(group);
    const shares = Object.fromEntries(
      Object.entries(previous).map(([id, share]) => [
        id,
        { knowledge: share.knowledge, use: share.use * (1 - fraction) },
      ])
    );
    for (const [language, weight] of weights) {
      const adoption = (fraction * weight) / total;
      const prior = previous[language] ?? { knowledge: 0, use: 0 };
      shares[language] = {
        knowledge: prior.knowledge + (1 - prior.knowledge) * adoption,
        use: prior.use * (1 - fraction) + adoption,
      };
    }
    return withLanguageShares(group, shares);
  });
}
/**
 * A language kept by fewer than one naming in a hundred is no longer passed on; knowledge of
 * it fades over three centuries toward the little use that remains. This is the brake on
 * reach through diversity: a seat that consolidates on one language loses the others and the
 * connections they opened. Contact itself never erases knowledge.
 */
const spokenUse = 0.01,
  forgettingYears = 300;
function forgetUnspoken(groups: PopulationGroup[], years: number) {
  const kept = Math.exp(-years / forgettingYears);
  return groups.map((group) => {
    const shares = languageShares(group);
    if (Object.values(shares).every((share) => share.use >= spokenUse)) return group;
    return withLanguageShares(
      group,
      Object.fromEntries(
        Object.entries(shares).map(([id, share]) => [
          id,
          share.use >= spokenUse
            ? share
            : { knowledge: share.use + (share.knowledge - share.use) * kept, use: share.use },
        ])
      )
    );
  });
}
/** Read all sources before writing any destination; contact changes use without moving people. */
export function evolveLanguageUse(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  const work = state.society!;
  if (work.inherited || years <= 0) return;
  const exposure = contacts(state);
  const mobility = Number(context.epochs.at(-1)?.variables.mobility ?? 1);
  for (const [i, c] of work.region.communities.entries()) {
    if (c.protected || population(c) <= 0) continue;
    c.groups = forgetUnspoken(adoptUse(c.groups, exposure[i], years, mobility), years);
  }
  context.recordCause({
    kind: "domain",
    process: "human.language-use",
    subjects: [],
    description:
      "Naming-language use changed through occupied community connections; multilingual knowledge, population totals and cultural identities were retained.",
  });
}
