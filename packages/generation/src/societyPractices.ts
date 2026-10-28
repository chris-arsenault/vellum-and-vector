import {
  communityPractices,
  isLivelihood,
  livelihoodShares,
  magicPracticeChannels,
  neighbors,
  population,
  practiceShares,
  relaxShares,
  spatial,
  withPracticeShares,
  type PracticeShares,
  type SocietyCommunity,
  type SocietyMagicPractice,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { changeSample, editableSamples } from "./societyWorks";
import { societyValue } from "./societySupport";

export { practiceSkill, practiceYieldGain } from "./societySkill";

/**
 * Doing writes the shares. Each cycle a group's practices move toward what its community
 * actually did: the livelihoods its country yielded and the magic its ledger shows in use.
 * The move is a relaxation with inertia, never a compounding of the shares on themselves,
 * so a people whose medium fails forgets the practice at the same pace it learned it.
 */
export const practiceLearningYears = 120;

/**
 * Fishing costs its medium as hunting costs the herds (ADR 0004): the fauna in the sea beside
 * a community's shore and in its rivers falls under the load of the people who fish them,
 * at the harvest rate hunting uses, and the ecology regrows it between cycles.
 */
export function fishWaters(state: GenerationState, years: number) {
  const work = state.society!;
  if (work.inherited || years <= 0 || !state.surface.channels.aquaticFauna) return;
  const editable = editableSamples(state, "aquaticFauna");
  for (const [j, load] of fishedWaters(state)) {
    if (!editable(j)) continue;
    const value = societyValue(state, "aquaticFauna", j);
    changeSample(state, "aquaticFauna", j, value * Math.exp((-load * years) / 150), "practice");
  }
}
/** The share of a community's people who fish, against the room its country gives them. */
function fishingLoads(state: GenerationState) {
  return state.society!.region.communities.map((c) => {
    const share = communityPractices(c.groups).fishing ?? 0;
    return share * Math.min(1, population(c) / Math.max(1, c.support.capacity));
  });
}
/** Each fished sample with the heaviest load on it: river cells, and the sea beside shore cells. */
function fishedWaters(state: GenerationState) {
  const work = state.society!,
    grid = state.surface,
    water = grid.channels.water,
    covers = spatial.geometryCoverage(grid.scope.footprint),
    loads = fishingLoads(state),
    taken = new Map<number, number>();
  const take = (j: number, load: number) => taken.set(j, Math.max(taken.get(j) ?? 0, load));
  for (let i = 0; i < work.owner.length; i++) {
    const load = loads[work.owner.get(i)] ?? 0;
    if (load <= 0) continue;
    if (work.river.get(i) > 0.2) take(i, load);
    if (work.coast.get(i) > 0 && water)
      for (const j of neighbors(grid, i, true, covers)) if (water.get(j) === 1) take(j, load);
  }
  return taken;
}

const isChannel = (id: string) =>
  isLivelihood(id) || (magicPracticeChannels as readonly string[]).includes(id);

/**
 * The magic a community practised this cycle, 0..1 per practice, read from its ledger: the
 * forge's heat is eight times the share of demand it met; memory access is the archive's
 * reach; divers are counted against the two in a thousand a community could send.
 */
function magicActivity(c: SocietyCommunity, ledger: SocietyMagicPractice): PracticeShares {
  const people = Math.max(1, population(c));
  const activity: PracticeShares = {
    "fire-forge": ledger.heatApplied / 8,
    "aurora-archive": ledger.memoryAccess,
    "pressure-diving": ledger.divers / (people * 0.002),
  };
  return Object.fromEntries(
    Object.entries(activity)
      .filter(([, share]) => share > 0)
      .map(([id, share]) => [id, Math.min(1, share)])
  );
}
/** What a community did: livelihood yields as a distribution, magic practice as engagement. */
export function realizedPractices(
  c: SocietyCommunity,
  ledger?: SocietyMagicPractice
): PracticeShares {
  return { ...livelihoodShares(c.support), ...(ledger ? magicActivity(c, ledger) : {}) };
}
export function learnPractices(state: GenerationState, context: MapProcessContext, years: number) {
  const work = state.society!;
  if (work.inherited || years <= 0) return;
  const fraction = -Math.expm1(-years / practiceLearningYears);
  const ledgers = new Map(work.region.magic.map((p) => [p.communityId, p]));
  for (const c of work.region.communities) {
    if (c.protected || population(c) <= 0) continue;
    const realized = realizedPractices(c, ledgers.get(c.id));
    c.groups = c.groups.map((g) => {
      const current = practiceShares(g);
      // An authored practice outside the channels is a record, not something the land teaches.
      const target = { ...realized };
      for (const id of Object.keys(current)) if (!isChannel(id)) target[id] = current[id];
      return withPracticeShares(g, relaxShares(current, target, fraction));
    });
  }
  context.recordCause({
    kind: "domain",
    process: "human.practices",
    subjects: [],
    description:
      "Practices follow doing: livelihood shares relax toward what each country yielded and magic practice toward what each ledger shows in use.",
  });
}
