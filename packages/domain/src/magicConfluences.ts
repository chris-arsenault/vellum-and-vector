import { z } from "zod";
import { magicFeatureSchema, type MagicSystem } from "./magicSystems";

const finite = z.number().finite();
const unit = finite.min(0).max(1);

/**
 * What a meeting does to the ground where it holds, scaled by its coverage in the cell.
 * Each field is a process on an existing physical channel, never a blend of the parents.
 */
export const confluenceEffectsSchema = z.object({
  /** Conductance added to the fractures, 0–1,000 units at full coverage. */
  fractureConductance: finite.default(0),
  /** Rock resistance change at full coverage; negative weakens. */
  rockResistance: finite.default(0),
  /** Amplitude of the bounded relief roughening, metres at full coverage. */
  relief: finite.nonnegative().default(0),
  /** Share of the soil removed at full coverage, 0–1. */
  soilRemoval: unit.default(0),
  /** External coastal forcing added on coast cells, 0–1,000 at full coverage. */
  coastalForcing: finite.min(0).max(1000).default(0),
  /** Fog forcing set on the cell, 0–1 at full coverage. */
  fog: unit.default(0),
  /** Ice removed, metres at full coverage. */
  iceMelt: finite.nonnegative().default(0),
  /** Sediment deposited as collapse debris, metres at full coverage. */
  debris: finite.nonnegative().default(0),
  /** Habitat toxicity set on the cell, 0–1 at full coverage. */
  toxicity: unit.default(0),
});
export const confluenceHazardSchema = z.object({
  kind: z.string().min(1),
  /** Events per year at full coverage. */
  rate: finite.nonnegative(),
  severity: unit,
  /** Metres. */
  radius: finite.positive(),
  cause: z.string().min(1),
});
/**
 * A meeting of two or more systems as a process of its own: where its conditions hold and
 * every parent reaches the coverage floor, it takes coverage from the parents in proportion
 * to the strain between them and acts on the physical fields with its own effects.
 */
export const magicConfluenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  systems: z.array(z.string().min(1)).min(2),
  floor: unit.default(0.2),
  /** Multiplies the strain before it is added to the quarter every meeting starts with. */
  strainScale: finite.nonnegative().default(4),
  priority: finite.default(100),
  cartography: magicFeatureSchema.shape.cartography,
  seeds: magicFeatureSchema.shape.seeds,
  retains: magicFeatureSchema.shape.retains,
  effects: confluenceEffectsSchema.prefault({}),
  hazard: confluenceHazardSchema.optional(),
});
export type MagicConfluence = z.infer<typeof magicConfluenceSchema>;
export type ConfluenceEffects = z.infer<typeof confluenceEffectsSchema>;

/**
 * Conditions a confluence may read: systems' intensities and physical fields only, never a
 * channel of its own. A confluence that names a system the world lacks is allowed and simply
 * never holds, so the preset meetings travel with any system list.
 */
export function validateMagicConfluences(confluences: MagicConfluence[], systems: MagicSystem[]) {
  void systems;
  const ids = new Set(confluences.map((confluence) => confluence.id));
  if (ids.size !== confluences.length) throw new Error("Confluences need distinct identities.");
  for (const confluence of confluences)
    for (const group of [...confluence.seeds, ...(confluence.retains ?? [])])
      for (const test of group)
        if (test.field.startsWith("source:") || ownChannels.has(test.field))
          throw new Error(`Confluence ${confluence.id} cannot read ${test.field}.`);
}
const ownChannels = new Set([
  "intensity",
  "history",
  "source",
  "wake",
  "rogue",
  "coastalHistory",
  "firstEpoch",
  "coastalFirstEpoch",
  "stored",
  "sealed",
]);
/** Whether every system a confluence reads is present and enabled. */
export function confluenceEffective(confluence: MagicConfluence, systems: MagicSystem[]) {
  return (
    confluence.enabled &&
    confluence.systems.every((id) => systems.some((system) => system.id === id && system.enabled))
  );
}

const at = (field: string, min: number) => ({ field, min });
/**
 * The bible's three meetings among Fire, Aurora and Pressure. Ids keep the names the
 * surface palette and saved maps already know (war, steam, breach).
 */
export function canonryConfluencePresets(): MagicConfluence[] {
  return [...elementalMeetings(), ...greenwoodMeetings(), ...saltMeetings()];
}
/** Salt meeting Aurora, Fire, Greenwood and Pressure. */
function saltMeetings(): MagicConfluence[] {
  return [
    magicConfluenceSchema.parse({
      id: "preserved",
      name: "Preserved barrow",
      systems: ["aurora", "salt"],
      priority: 96,
      cartography: "area",
      seeds: [[at("system:aurora", 300), at("system:salt", 200), { field: "water", values: [0] }]],
      // Undeath: nothing decays, nothing grows, nothing erodes. The ground holds; the hazard
      // is the dead themselves.
      effects: { rockResistance: 200, toxicity: 0.3 },
      hazard: {
        kind: "undead",
        rate: 0.001,
        severity: 0.3,
        radius: 2000,
        cause: "Aurora held a Salt barrow still and its dead did not rest.",
      },
    }),
    magicConfluenceSchema.parse({
      id: "fired",
      name: "Fired crust",
      systems: ["fire", "salt"],
      priority: 97,
      cartography: "area",
      seeds: [[at("system:fire", 300), at("system:salt", 200), { field: "water", values: [0] }]],
      // Salting fused to glass and shed: a scoured surface that recovers within an epoch.
      effects: { rockResistance: 300, soilRemoval: 0.5 },
    }),
    magicConfluenceSchema.parse({
      id: "standing-dead",
      name: "Standing-dead front",
      systems: ["greenwood", "salt"],
      priority: 93,
      cartography: "area",
      seeds: [
        [at("system:greenwood", 300), at("system:salt", 200), { field: "water", values: [0] }],
      ],
      // Trees die without falling where verdure and salting meet; the front moves with them.
      effects: { toxicity: 0.5 },
    }),
    magicConfluenceSchema.parse({
      id: "brine-shore",
      name: "Brine shore",
      systems: ["pressure", "salt"],
      priority: 94,
      cartography: "area",
      seeds: [
        [at("system:pressure", 300), at("system:salt", 200), { field: "water", values: [0] }],
      ],
      // A sabkha behind a still Pressure coast: brine fog, and the storms lift its dust.
      effects: { fog: 0.3, toxicity: 0.2 },
    }),
  ];
}
/** Fire, Aurora and Pressure meeting one another. */
function elementalMeetings(): MagicConfluence[] {
  return [
    magicConfluenceSchema.parse({
      id: "war",
      name: "Shatter rim",
      systems: ["fire", "aurora"],
      cartography: "area",
      seeds: [[at("system:fire", 260), at("system:aurora", 340)]],
      // Rock split between held heat and held cold: open fractures, weakened rock, needle
      // fields where soil cannot hold.
      effects: {
        fractureConductance: 220,
        rockResistance: -320,
        relief: 40,
        soilRemoval: 0.8,
        toxicity: 0.2,
      },
      hazard: {
        kind: "thermal-fracture",
        rate: 0.001,
        severity: 0.3,
        radius: 2000,
        cause: "Fire heat met Aurora-bearing ice and the ground shattered between them.",
      },
    }),
    magicConfluenceSchema.parse({
      id: "steam",
      name: "Boiling shore",
      systems: ["fire", "pressure"],
      priority: 110,
      cartography: "course",
      seeds: [[at("system:fire", 390), at("system:pressure", 420), at("fracture", 520)]],
      // Fractures vent under the sea: the coast is driven back into stacks and blowholes.
      effects: { fractureConductance: 120, coastalForcing: 320, fog: 0.4, soilRemoval: 0.3 },
      hazard: {
        kind: "steam-fracture",
        rate: 0.002,
        severity: 0.4,
        radius: 3000,
        cause: "Ocean Pressure entered conductive Fire fractures and the shore boiled.",
      },
    }),
    magicConfluenceSchema.parse({
      id: "breach",
      name: "Breach",
      systems: ["pressure", "aurora"],
      priority: 120,
      cartography: "site",
      seeds: [
        [
          at("system:pressure", 390),
          at("system:aurora", 430),
          { field: "water", values: [1] },
          at("ice", 220),
        ],
      ],
      // A front punches an ice coast: the ice goes, collapse debris spreads, cold fog sits.
      effects: { iceMelt: 60, debris: 3, fog: 0.5, coastalForcing: 240 },
      hazard: {
        kind: "pressure-ice-breach",
        rate: 0.002,
        severity: 0.4,
        radius: 5000,
        cause: "Pressure reached charged coastal ice and breached it.",
      },
    }),
  ];
}
/** Greenwood meeting Fire, Aurora and Pressure. */
function greenwoodMeetings(): MagicConfluence[] {
  return [
    magicConfluenceSchema.parse({
      id: "rot",
      name: "Overgrowth rot",
      systems: ["fire", "greenwood"],
      priority: 95,
      cartography: "area",
      seeds: [
        [at("system:fire", 300), at("system:greenwood", 300), { field: "water", values: [0] }],
      ],
      // Verdure under quickening outruns structure: trees rot standing, the ground turns
      // toxic with fungus, and the springs boil and fracture it with steam.
      effects: { toxicity: 0.6, soilRemoval: 0.2, fractureConductance: 80, fog: 0.2 },
      hazard: {
        kind: "rot-fever",
        rate: 0.0015,
        severity: 0.25,
        radius: 2500,
        cause: "Fire quickened a Greenwood until it rotted and its springs boiled.",
      },
    }),
    magicConfluenceSchema.parse({
      id: "frozen",
      name: "Frozen Deepwood",
      systems: ["aurora", "greenwood"],
      priority: 90,
      cartography: "area",
      seeds: [[at("system:aurora", 400), at("system:greenwood", 300), at("ice", 50)]],
      // Forest preserved standing under held charge: canopy without growth or decay. The
      // stillness already holds it; the meeting marks and keeps the front where the ice is.
      effects: { iceMelt: 0 },
    }),
    magicConfluenceSchema.parse({
      id: "brackish",
      name: "Brackish wending",
      systems: ["pressure", "greenwood"],
      priority: 92,
      cartography: "area",
      seeds: [
        [at("system:pressure", 300), at("system:greenwood", 300), { field: "water", values: [0] }],
      ],
      // Upwelling salts the coastal springs: the fen turns tidal marsh and the wells fail.
      effects: { toxicity: 0.3, fog: 0.3 },
    }),
  ];
}
