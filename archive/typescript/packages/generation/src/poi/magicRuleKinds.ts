import type { PoiKindId } from "./poiKinds";

/**
 * The kind each magic system's place rule publishes as. Every rule of every system has one, and
 * a test holds the table to the presets, so a rule cannot go without an entry.
 */
export const magicRuleKinds: Readonly<Record<string, Readonly<Record<string, PoiKindId>>>> = {
  fire: {
    core: "fireCore",
    vein: "thermalVein",
    spring: "spring",
    vent: "vent",
    basalt: "basaltFlat",
    scar: "basaltScar",
    crater: "crater",
    fan: "ejectaFan",
    placer: "placer",
    deviation: "compassDeviation",
    halo: "thawedHalo",
  },
  aurora: { field: "auroraField", well: "lightWell", prism: "frostPrism", melt: "meltLine" },
  pressure: {
    locus: "pressureLocus",
    crush: "crushZone",
    front: "upwellingFront",
    wake: "ancientWake",
    lattice: "interferenceLattice",
    rogue: "rogueWaveImpact",
  },
  greenwood: {
    stand: "greenwoodStand",
    wellspring: "spring",
    oasis: "oasis",
    verdant: "verdantGround",
    sinkhole: "sinkholeField",
  },
  salt: { ground: "killingGround", pan: "saltPan", flat: "glassFlat", dust: "saltDust" },
  veil: { tear: "tear", wild: "wildZone", door: "door" },
  hallowed: { ring: "wardRing", line: "wardLine" },
};
