import {
  gridPosition,
  population,
  MapScale,
  type SocietyCommunity,
  type SocietyMagicPractice,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { makeWork } from "./societyWorks";
import { nearestSample } from "./societySpatial";
import { societyValue } from "./societySupport";
import { peopleTrait } from "./societyTraits";
import { practiceSkill } from "./societySkill";
import { mapScale } from "./worldSignificance";
import { gatherSolid, useSolid, tradeSolid, carriedSolid } from "./societyMaterials";
import {
  accessibleDive,
  depositAt,
  drawAt,
  magicAt,
  magicSystemForRole,
  reservoirAt,
} from "./societyMagicAccess";

export { magicAt } from "./societyMagicAccess";
/** Degrees a forge at full use gives its seat, and the share of its heat that takes ice in a year. */
export const fullForgeHeat = 8,
  thawShare = 0.02;
/** Ice and cold that hold a memory in full, in metres and degrees of frost. */
export const memoryIce = MapScale.length(0.0000025),
  memoryCold = 10;
/** Stock amount (intensity·m²) one core-equivalent of the practice ledger stands for. */
const stockPerCore = MapScale.area(6.25e-7);
/** Charge represented by one crystal-equivalent in the existing practice display. */
const stockPerCrystal = MapScale.area(6.25e-10);
/**
 * Share of the sap under a seat a community gathers per year, and the most per head. At this
 * a market two centuries down the road from a full Deepwood seat has planted sap enough for
 * a grove past the source floor.
 */
const seedGathering = { share: 0.004, perHead: MapScale.area(3.125e-9) };
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
/** Live material is authoritative, including when society works on captured geography. */
function drawHeldStock(state: GenerationState, community: string, sample: number, cores: number) {
  const stock = mapScale(state).resolveMeasure(stockPerCore);
  return gatherSolid(state, "quickens", "held", community, sample, cores * stock) / stock;
}
/**
 * Cores cracked in the forge release where they are cracked: the stock moves from the ledger
 * people carried to the forge reservoir on the mesh, and the forge origin finds it there.
 */
function crackCores(state: GenerationState, sample: number, used: number) {
  depositAt(
    state,
    "quickens",
    "forge",
    sample,
    used * mapScale(state).resolveMeasure(stockPerCore)
  );
}
function initialPractice(state: GenerationState, c: SocietyCommunity): SocietyMagicPractice {
  const i = nearestSample(state, c.position),
    scale = mapScale(state),
    deposit = heldStockAt(state, i) / scale.resolveMeasure(stockPerCore);
  return {
    communityId: c.id,
    coreDeposit: deposit,
    coreSupply: 0,
    coreUsed: 0,
    heatApplied: 0,
    crystals: 0,
    charge: 0,
    readers: 0,
    memoryAccess: 0,
    pressureCharge: 0,
    pressureUsed: 0,
    maritimeContact: 0,
    divers: 0,
    depthLimit: peopleTrait(state, c, "divingDepth", scale.length(0.00005)),
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
  const requested = population(c) * years * 0.002 * skill("fire-forge");
  const sample = nearestSample(state, c.position);
  drawHeldStock(state, c.id, sample, requested);
  practice.coreDeposit =
    reservoirAt(state, "quickens", "held", sample) / mapScale(state).resolveMeasure(stockPerCore);
  practice.coreSupply =
    carriedSolid(state, "quickens", c.id, sample) / mapScale(state).resolveMeasure(stockPerCore);
  const demand = population(c) * years * 0.0005,
    stock = mapScale(state).resolveMeasure(stockPerCore),
    used =
      useSolid(
        state,
        "quickens",
        c.id,
        sample,
        Math.min(practice.coreSupply, demand) * stock,
        true
      ) / stock;
  practice.coreSupply -= used;
  practice.coreUsed += used;
  crackCores(state, nearestSample(state, c.position), used);
  if (used <= 0 && practice.heatApplied <= 0) return;
  const work = workFor(state, c, "fire-forge"),
    heat = (fullForgeHeat * used) / Math.max(1, demand);
  // The heat on the ground is the forge entry's: its place reads this ledger.
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
  const i = nearestSample(state, c.position),
    stock = mapScale(state).resolveMeasure(stockPerCrystal),
    demand = population(c) * years * 0.002 * skill("aurora-archive");
  gatherSolid(state, "stills", "ground", c.id, i, demand * stock);
  gatherSolid(state, "stills", "moraine", c.id, i, demand * stock, true);
  p.crystals = carriedSolid(state, "stills", c.id, i) / stock;
  if (p.crystals <= 0) return;
  const cold = Math.max(0, Math.min(1, -societyValue(state, "temperature", i) / memoryCold));
  const retained =
    Math.min(
      1,
      societyValue(state, "iceThickness", i) / mapScale(state).resolveMeasure(memoryIce)
    ) * cold;
  useSolid(
    state,
    "stills",
    c.id,
    i,
    p.crystals * stock * (1 - Math.exp((-years * (1 - retained)) / 200)),
    true
  );
  p.charge = carriedSolid(state, "stills", c.id, i) / stock;
  p.readers = (population(c) * 0.005 * skill("aurora-archive")) / (1 + p.strain);
  const use =
    useSolid(state, "stills", c.id, i, Math.min(p.charge, p.readers * years * 0.02) * stock, true) /
    stock;
  p.crystals = carriedSolid(state, "stills", c.id, i) / stock;
  p.charge = p.crystals;
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
  const enabled = ocean && depth >= mapScale(state).length(0.0000125) && depth <= p.depthLimit;
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
      population(c) * years * mapScale(state).resolveMeasure(seedGathering.perHead)
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
  p.salt = carriedSolid(state, "salts", c.id, i);
  if (bed > 0) {
    const wanted = Math.min(
      bed * raking.share * years,
      population(c) * years * mapScale(state).resolveMeasure(raking.perHead)
    );
    p.salt += gatherSolid(state, "salts", "bed", c.id, i, wanted, true);
  }
  const laid = p.salt * (1 - Math.exp(-saltLaying * years));
  if (laid <= 0) return;
  p.salt -= useSolid(state, "salts", c.id, i, laid);
}
/** Share of the bed under a seat raked per year, and the most per head; share of carried salt laid per year. */
const raking = { share: 0.002, perHead: MapScale.area(1.25e-9) };
const saltLaying = 0.05;
/** What a way carries in a year relative to the base: distance decay, more on a worn road. */
function wayFlow(scale: MapScale, link: { travelCost: number; wear?: number }) {
  return (
    Math.exp(-link.travelCost / scale.length(0.05)) * (1 + Math.min(1, (link.wear ?? 0) / 1000))
  );
}
const tradedLedgers = ["coreSupply", "seed", "salt"] as const;
/** Years over which a unit-flow way exchanges stock in response to its two ends' difference. */
const tradeResponseYears = 35;
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
    // Both ends change as stock moves: integrate their difference's decay toward equal shares.
    // Faster ways change the rate, so a long cycle cannot overshoot or overdraw either end.
    const share =
      -Math.expm1((-2 * years * wayFlow(mapScale(state), link)) / tradeResponseYears) / 2;
    for (const ledger of tradedLedgers) {
      const requested = ((a[ledger] ?? 0) - (b[ledger] ?? 0)) * share,
        surplus =
          ledger === "seed"
            ? requested
            : tradeParcels(state, ledger, a.communityId, b.communityId, requested);
      a[ledger] = (a[ledger] ?? 0) - surplus;
      b[ledger] = (b[ledger] ?? 0) + surplus;
    }
  }
}
function tradeParcels(
  state: GenerationState,
  ledger: "salt" | "coreSupply",
  a: string,
  b: string,
  amount: number
) {
  const communities = state.society!.region.communities,
    source = communities.find((c) => c.id === (amount >= 0 ? a : b)),
    target = communities.find((c) => c.id === (amount >= 0 ? b : a));
  if (!source || !target) return 0;
  const unit = ledger === "coreSupply" ? mapScale(state).resolveMeasure(stockPerCore) : 1;
  return (
    (Math.sign(amount) *
      tradeSolid(
        state,
        ledger === "salt" ? "salts" : "quickens",
        source.id,
        target.id,
        nearestSample(state, source.position),
        nearestSample(state, target.position),
        Math.abs(amount) * unit
      )) /
    unit
  );
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
