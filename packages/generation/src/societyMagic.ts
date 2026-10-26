import {
  gridPosition,
  population,
  type SocietyCommunity,
  type SocietyMagicPractice,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { changeSample, editableSamples, makeWork, workSamples } from "./societyWorks";
import { nearestSample } from "./societySpatial";
import { societyValue } from "./societySupport";
import { peopleTrait } from "./societyTraits";
import { practiceSkill } from "./societySkill";
import {
  accessibleDive,
  depositAt,
  drawAt,
  magicAt,
  magicSystemForRole,
  reservoirAt,
} from "./societyMagicAccess";

export { magicAt } from "./societyMagicAccess";
/** Stock amount (intensity·m²) one core-equivalent of the practice ledger stands for. */
const stockPerCore = 1e7;
/**
 * Share of the sap under a seat a community gathers per year, and the most per head. At this
 * a market two centuries down the road from a full Deepwood seat has planted sap enough for
 * a grove past the source floor.
 */
const seedGathering = { share: 0.004, perHead: 5e4 };
/** Share of carried seed a community plants at its seat per year. */
const seedPlanting = 0.05;
/** The held stock of the system that quickens, read at a sample from its published channels. */
function heldStockAt(state: GenerationState, i: number) {
  const system = magicSystemForRole(state.domain.world.magicSystems, "quickens");
  if (!system) return 0;
  let total = 0;
  for (const origin of system.origins)
    for (const stock of origin.stocks)
      if (stock.reservoir === "held")
        total += societyValue(state, `magic:${system.id}:stock:${origin.id}/${stock.id}`, i);
  return total;
}
/** Mining takes cores out of the mesh where the field is live in this generation. */
function drawHeldStock(state: GenerationState, sample: number, amount: number) {
  drawAt(state, "quickens", "held", sample, amount);
}
/**
 * Cores cracked in the forge release where they are cracked: the stock moves from the ledger
 * people carried to the forge reservoir on the mesh, and the forge origin finds it there.
 */
function crackCores(state: GenerationState, sample: number, used: number) {
  depositAt(state, "quickens", "forge", sample, used * stockPerCore);
}
function initialPractice(state: GenerationState, c: SocietyCommunity): SocietyMagicPractice {
  const i = nearestSample(state, c.position),
    ice = societyValue(state, "iceThickness", i);
  // The deposit is the held stock under the seat (vein cores and fallen cores alike) plus a
  // mineral estimate from the field; extraction draws the stock down on the mesh.
  const deposit =
    Math.max(0, magicAt(state, "quickens", i)) * Math.min(c.areaKm2, 100) * 100 +
    heldStockAt(state, i) / stockPerCore;
  return {
    communityId: c.id,
    coreDeposit: deposit,
    coreSupply: 0,
    coreUsed: 0,
    heatApplied: 0,
    crystals: magicAt(state, "stills", i) * Math.min(1000, ice),
    charge: 0,
    readers: 0,
    memoryAccess: 0,
    pressureCharge: 0,
    pressureUsed: 0,
    maritimeContact: 0,
    divers: 0,
    depthLimit: peopleTrait(state, c, "divingDepth", 200),
    injuries: 0,
    strain: 0,
  };
}
function workFor(
  state: GenerationState,
  c: SocietyCommunity,
  kind: "fire-forge" | "aurora-archive" | "pressure-diving"
) {
  const region = state.society!.region;
  const existing = region.works.find((w) => w.communityId === c.id && w.kind === kind);
  if (existing) return existing;
  // A practice happens at its forge, archive or dive: located at every profile.
  const work = makeWork(state, c, kind, c.position);
  region.works.push(work);
  return work;
}
/** The factor a community's practice earns in a channel; skilled hands mine, read and dive more. */
type Skill = (channel: string) => number;
function fireUse(
  state: GenerationState,
  c: SocietyCommunity,
  practice: SocietyMagicPractice,
  years: number,
  skill: Skill
) {
  const extracted = Math.min(
    practice.coreDeposit,
    population(c) * years * 0.002 * skill("fire-forge")
  );
  practice.coreDeposit -= extracted;
  practice.coreSupply += extracted;
  drawHeldStock(state, nearestSample(state, c.position), extracted * stockPerCore);
  const demand = population(c) * years * 0.0005,
    used = Math.min(practice.coreSupply, demand);
  practice.coreSupply -= used;
  practice.coreUsed += used;
  crackCores(state, nearestSample(state, c.position), used);
  if (used <= 0 && practice.heatApplied <= 0) return;
  const work = workFor(state, c, "fire-forge"),
    heat = (8 * used) / Math.max(1, demand);
  const editableHeat = editableSamples(state, "temperature"),
    editableIce = editableSamples(state, "iceThickness");
  // The forge warms its seat cell: synchronized to the mesh, but below the scale that
  // re-propagates a magic field.
  for (const { i, fraction } of workSamples(state, work)) {
    if (editableHeat(i))
      changeSample(
        state,
        "temperature",
        i,
        societyValue(state, "temperature", i, 15) + (heat - practice.heatApplied) * fraction,
        "practice"
      );
    if (editableIce(i))
      changeSample(
        state,
        "iceThickness",
        i,
        Math.max(0, societyValue(state, "iceThickness", i) - heat * fraction * years * 0.02),
        "practice"
      );
  }
  practice.injuries += used * 0.002;
  practice.heatApplied = heat;
  work.causes = [
    `Consumed ${used.toFixed(1)} core-equivalents for contact heat; ${practice.coreDeposit.toFixed(1)} remain in the deposit.`,
  ];
}
function auroraUse(
  state: GenerationState,
  c: SocietyCommunity,
  p: SocietyMagicPractice,
  years: number,
  skill: Skill
) {
  if (p.crystals <= 0) return;
  const i = nearestSample(state, c.position),
    intensity = magicAt(state, "stills", i);
  const cold = Math.max(0, Math.min(1, -societyValue(state, "temperature", i) / 10));
  const retained = Math.min(1, societyValue(state, "iceThickness", i) / 10) * cold;
  p.crystals *= Math.exp((-years * (1 - retained)) / 200);
  p.charge = Math.min(p.crystals, p.charge + (intensity * p.crystals * years) / 50);
  p.readers = (population(c) * 0.005 * skill("aurora-archive")) / (1 + p.strain);
  const use = Math.min(p.charge, p.readers * years * 0.02);
  p.charge -= use;
  p.strain = p.strain * Math.exp(-years / 20) + use / Math.max(1, p.readers * 100);
  p.memoryAccess = Math.min(
    1,
    p.memoryAccess * Math.exp((-years * (1 - retained)) / 200) + use / Math.max(1, population(c))
  );
  const work = workFor(state, c, "aurora-archive");
  work.causes = [
    `Cold memory-bearing ice and ${p.crystals.toFixed(1)} crystals support ${p.readers.toFixed(1)} readers; access is limited by charge and cognitive strain.`,
  ];
}
function pressureUse(
  state: GenerationState,
  c: SocietyCommunity,
  p: SocietyMagicPractice,
  years: number,
  skill: Skill
) {
  const i = accessibleDive(state, c, p.depthLimit);
  const nearby = state.society!.region.works.find(
    (w) => w.communityId === c.id && w.kind === "pressure-diving"
  );
  const at = nearby ? nearestSample(state, nearby.position) : i;
  if (at < 0) {
    p.divers = 0;
    p.pressureCharge *= Math.exp(-years / 5);
    return;
  }
  const depth = societyValue(state, "waterDepth", at);
  const ocean = societyValue(state, "water", at) === 1;
  const enabled = ocean && depth >= 50 && depth <= p.depthLimit;
  const intensity = enabled ? magicAt(state, "moves-water", at) : 0;
  p.divers =
    intensity > 0 ? (population(c) * 0.002 * skill("pressure-diving")) / (1 + p.strain) : 0;
  p.pressureCharge = Math.max(
    0,
    p.pressureCharge * Math.exp(-years / 5) + intensity * p.divers * (1 - Math.exp(-years / 5))
  );
  // Carried Pressure dissipates near Aurora crystals rather than combining into a spell.
  p.pressureCharge *= Math.exp(-p.crystals / 10);
  if (p.divers <= 0) return;
  p.strain += p.pressureCharge / Math.max(1, p.divers * 10);
  const spent = p.pressureCharge * (1 - Math.exp(-years / 10));
  p.pressureCharge -= spent;
  p.pressureUsed += spent;
  p.maritimeContact = spent / Math.max(1, p.divers);
  // Directed force assists located harbor maintenance; it cannot strengthen an entire coast.
  const harbor = state.society!.region.works.find(
    (w) => w.kind === "harbor" && w.communityId === c.id
  );
  if (harbor) harbor.condition = Math.min(1, harbor.condition + spent / Math.max(1, population(c)));
  const work = workFor(state, c, "pressure-diving");
  work.position = gridPosition(state.surface, at);
  work.causes = [
    `${p.divers.toFixed(1)} practitioners reach ${depth.toFixed(0)} m within a ${p.depthLimit} m tolerance; directed force and subsonic contact consumed ${spent.toFixed(1)} carried charge.`,
  ];
}
/**
 * Greenwood in people's hands: a community whose seat stands on sap gathers seed from it,
 * and every community plants a share of the seed it carries at its seat. Seed traded down a
 * road out of a Deepwood founds groves at the markets that receive it.
 */
function greenwoodUse(
  state: GenerationState,
  c: SocietyCommunity,
  p: SocietyMagicPractice,
  years: number
) {
  const i = nearestSample(state, c.position),
    sap = reservoirAt(state, "greens", "sap", i);
  p.seed ??= 0;
  if (sap > 0) {
    const wanted = Math.min(
      sap * seedGathering.share * years,
      population(c) * years * seedGathering.perHead
    );
    p.seed += drawAt(state, "greens", "sap", i, wanted);
  }
  const planted = p.seed * (1 - Math.exp(-seedPlanting * years));
  if (planted <= 0) return;
  p.seed -= depositAt(state, "greens", "sap", i, planted);
}
/**
 * Salt in people's hands: rakers take bed from the pan under their seat into a ledger that
 * trade carries, and a community lays down a share of the salt it holds where it stands, so
 * the salt trade salts the necropolises it supplies.
 */
function saltUse(
  state: GenerationState,
  c: SocietyCommunity,
  p: SocietyMagicPractice,
  years: number
) {
  const i = nearestSample(state, c.position),
    bed = reservoirAt(state, "salts", "bed", i);
  p.salt ??= 0;
  if (bed > 0) {
    const wanted = Math.min(bed * raking.share * years, population(c) * years * raking.perHead);
    p.salt += drawAt(state, "salts", "bed", i, wanted);
  }
  const laid = p.salt * (1 - Math.exp(-saltLaying * years));
  if (laid <= 0) return;
  p.salt -= depositAt(state, "salts", "bed", i, laid);
}
/** Share of the bed under a seat raked per year, and the most per head; share of carried salt laid per year. */
const raking = { share: 0.002, perHead: 2e4 };
const saltLaying = 0.05;
/** What a way carries in a year relative to the base: distance decay, more on a worn road. */
function wayFlow(link: { travelCost: number; wear?: number }) {
  return Math.exp(-link.travelCost / 200000) * (1 + Math.min(1, (link.wear ?? 0) / 1000));
}
const tradedLedgers = ["coreSupply", "seed", "salt"] as const;
/**
 * Trade carries the ledgers people hold along the ways between communities, each toward the
 * poorer end in proportion to the way's flow: cores from the mines to the forges, seed from
 * the Deepwood to the markets.
 */
function tradeStocks(state: GenerationState, years: number) {
  const region = state.society!.region,
    practices = new Map(region.magic.map((p) => [p.communityId, p]));
  for (const link of region.connections) {
    const a = practices.get(link.from),
      b = practices.get(link.to);
    if (!a || !b) continue;
    const share = (1 - Math.exp(-years / 35)) * wayFlow(link);
    for (const ledger of tradedLedgers) {
      const surplus = ((a[ledger] ?? 0) - (b[ledger] ?? 0)) * share;
      a[ledger] = (a[ledger] ?? 0) - surplus;
      b[ledger] = (b[ledger] ?? 0) + surplus;
    }
  }
}
export function useSocietyMagic(state: GenerationState, context: MapProcessContext, years: number) {
  const region = state.society!.region;
  if (state.society!.inherited) return;
  const previous = new Map(region.magic.map((p) => [p.communityId, p]));
  region.magic = region.communities.map((c) => previous.get(c.id) ?? initialPractice(state, c));
  for (const [i, c] of region.communities.entries()) {
    if (c.protected) continue;
    const p = region.magic[i],
      skill = practiceSkill(c.groups);
    p.injuries *= Math.exp(-years / 30);
    fireUse(state, c, p, years, skill);
    auroraUse(state, c, p, years, skill);
    pressureUse(state, c, p, years, skill);
    greenwoodUse(state, c, p, years);
    saltUse(state, c, p, years);
  }
  tradeStocks(state, years);
  context.recordCause({
    kind: "domain",
    process: "human.magic-use",
    subjects: [],
    description:
      "Fire use consumes mined cores and cracks them at the forge; Aurora access depends on cold crystals and rested readers; Pressure practice requires reachable ocean depth; Greenwood seed is gathered, traded and planted. Their costs and media remain distinct.",
  });
}
