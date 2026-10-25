import { z } from "zod";

const finite = z.number().finite();
const positive = finite.positive();
const condition = z.object({
  field: z.string().min(1),
  min: finite.optional(),
  max: finite.optional(),
  values: z.array(finite).optional(),
  salt: z.number().int().optional(),
  index: z.number().int().optional(),
});
// Alternatives of conjunctions: any group may seed or retain a feature region.
export const magicFeatureSchema = z.object({
  cartography: z.enum(["site", "area", "course"]).optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  priority: finite.default(1),
  seeds: z.array(z.array(condition).min(1)).min(1),
  retains: z.array(z.array(condition).min(1)).optional(),
  /**
   * How much of a member cell the class occupies: the named field mapped linearly from
   * `floor` (none) to `full` (the whole cell). Without it a member cell is wholly covered.
   */
  coverage: z
    .object({ field: z.string().min(1), floor: finite, full: finite })
    .refine((range) => range.full > range.floor, "Coverage needs full above floor")
    .optional(),
});

export const magicSources = [
  "geothermal",
  "cold",
  "deep-ocean",
  "placed",
  "verdant",
  "aquifer",
  "impact",
  "forge",
  "death",
  "dead-lake",
  "tenure",
  "kept-line",
  "strain",
  "pairing",
] as const;
export const magicPropagations = [
  "fracture",
  "cold-drainage",
  "ocean-rays",
  "radial",
  "roots",
  "local",
  "brine",
  "ward",
] as const;
/**
 * How an origin's stock is renewed: fed while its conduit is open and sealed after a budget,
 * accumulating across epochs, continuous from a standing source, a finite stock that only
 * runs down, kept by maintenance, or emergent from other systems' fields.
 */
export const magicRenewals = [
  "conduit-fed",
  "accumulating",
  "continuous",
  "finite",
  "kept",
  "emergent",
] as const;
/** The world's own transports a stock can ride between evaluations. */
export const magicCarriers = [
  "crust",
  "ice",
  "river",
  "groundwater",
  "wind",
  "current",
  "animal",
  "people",
  "door",
] as const;
export type MagicSource = (typeof magicSources)[number];
export type MagicPropagation = (typeof magicPropagations)[number];
export type MagicRenewal = (typeof magicRenewals)[number];
export type MagicCarrier = (typeof magicCarriers)[number];

const parameterSchema = z.object({
  sourceThreshold: finite.default(300),
  maximumSources: z.number().int().nonnegative().default(900),
  sourceSpacing: finite.nonnegative().default(45_000),
  baseCost: positive.default(4),
  conductanceDivisor: positive.default(26),
  baseInput: finite.nonnegative().default(360),
  logScale: finite.nonnegative().default(66),
  iceRetention: positive.default(1200),
  coldRetentionDistance: positive.default(10_000),
  accumulationArea: positive.default(100_000_000),
  featureNoiseScale: positive.default(70_000),
  rayCount: z.number().int().nonnegative().default(1200),
  rayDistance: positive.default(4_400_000),
  coastalRayDistance: positive.default(1_300_000),
  wakeDistance: positive.default(1_900_000),
  beamWidth: positive.default(20_000),
  coastalSources: z.number().int().nonnegative().default(200),
  coastalSourceDistance: positive.default(100_000),
  wakeSources: z.number().int().nonnegative().default(260),
  coastalThreshold: finite.min(0).max(999).default(140),
  waveAmplification: finite.nonnegative().default(0.36),
  currentAmplification: finite.nonnegative().default(0.18),
  // Energy a ray loses per 10 km of open water; reflections cost more.
  rayDecay: finite.nonnegative().default(3),
  // Intensity a ray at 1,000 energy deposits on the cell it crosses per beam step.
  rayIntensity: finite.nonnegative().default(27.8),
  // Intensity a wake leaves along its track, before the activity scale.
  wakeStrength: finite.nonnegative().default(180),
  // Accumulated intensity (summed over epochs) after which a Fire conduit seals.
  conduitBudget: positive.default(2400),
  // Stock an impact leaves per cubic metre of ejecta, in intensity·m².
  fallenDensity: finite.nonnegative().default(0.1),
  // Share of exposed held stock a finite origin releases per epoch with no cracking agent.
  fallenRelease: finite.min(0).max(1).default(0.04),
  // Release added per unit of tectonic strain, ice load (at the crack depth) and frost.
  strainCracking: finite.nonnegative().default(0.3),
  iceCracking: finite.nonnegative().default(0.5),
  iceCrackDepth: positive.default(300),
  frostCracking: finite.nonnegative().default(0.05),
  // Release added in the epoch the stock arrives, from the impact's own shock.
  impactShock: finite.min(0).max(1).default(0.3),
  // Share of impact heat that is a coreless source, decaying with the epochs since.
  impactHeatShare: finite.min(0).max(1).default(0.6),
  // Share of a river-carried stock that moves one cell downstream per epoch.
  placerMobility: finite.min(0).max(1).default(0.15),
  // Sediment depth (metres) beneath which a stock is inert.
  buryDepth: positive.default(20),
  // Strain at which a sealed conduit reopens, and the budget share it reopens with.
  reopenStrain: finite.min(0).max(1000).default(600),
  reopenShare: finite.min(0).max(1).default(0.4),
  // Share of exposed spent stock that feeds the source again.
  exhumedRelease: finite.min(0).max(1).default(0.3),
  // Epochs an ejecta fan stays barren, and the ejecta depth (metres) that makes it so.
  fanBarrenEpochs: finite.nonnegative().default(3),
  fanBarrenDepth: positive.default(2),
  // Strength at which held charge acts with no ice over it, as a share of its iced strength.
  relictStrength: finite.min(0).max(1).default(0.5),
  // Share of the ice reservoir that moves one cell along the ice flow per epoch.
  iceCarry: finite.min(0).max(1).default(0.8),
  // Share of the ice reservoir lost with full glacial meltwater per epoch.
  meltwaterLoss: finite.min(0).max(1).default(0.2),
  // Charge per metre of ice (intensity·m² per m³) at which the ice counts as fully charged.
  iceChargeSaturation: positive.default(2),
  // Ground lowered per unit of thawed charge (metres per 1,000 of stored lost) and its bound.
  thawSubsidence: finite.nonnegative().default(3),
  thawSubsidenceLimit: finite.nonnegative().default(6),
  // Shelf charge per square metre at which sea ice is fully held.
  shelfSaturation: positive.default(500),
  // Sea-surface anomaly difference between neighbours (native units, 10 per °C) that makes a
  // front sharp enough to raise a full storm.
  stormFrontGradient: positive.default(30),
  // A stand is old growth past this canopy age (years) with at least this tree cover, or
  // peat at least this deep (peat carbon).
  standAge: finite.nonnegative().default(600),
  standCover: finite.min(0).max(1).default(0.6),
  peatDepth: finite.nonnegative().default(10),
  // Root cost per kilometre through full cover, and the cover below which thin soil is bare rock.
  rootCost: positive.default(2),
  rootFloor: finite.min(0).max(1).default(0.12),
  // A spring needs this much flow accumulation on rock no harder than this.
  springFlow: finite.nonnegative().default(40),
  springRock: finite.nonnegative().default(700),
  // A spring drawn past this share of its recharge in one epoch collapses its karst by this depth.
  overdrawShare: finite.min(0).max(1).default(0.5),
  sinkDepth: finite.nonnegative().default(4),
  // Share of a stock herbivores carry to the cells they graze toward, per epoch.
  animalCarry: finite.min(0).max(1).default(0.1),
  // Share of buried peat carbon that becomes stratum stock per epoch.
  strataShare: finite.nonnegative().default(0.02),
  // Planted sap per square metre that counts as a full grove, and the share of sap a cell
  // without a stand loses per epoch.
  groveSap: positive.default(400),
  sapLoss: finite.min(0).max(1).default(0.3),
  // Cracked cores per square metre at a forge that make a full source, and the share of
  // the cracked stock that cools away per epoch.
  forgeStrength: positive.default(250),
  forgeCooling: finite.min(0).max(1).default(0.5),
  // Salt: stock made per death and per metre of a dried lake's depth (per square metre of
  // its bed), and the salt per square metre that is full intensity.
  saltPerDeath: finite.nonnegative().default(5_000_000),
  saltPerLakeMetre: finite.nonnegative().default(40),
  saltFull: positive.default(400),
  // Brine: share flushed per epoch at full air moisture on oxygenated ground, share that seeps
  // one cell down the drainage, and share that crusts to bed at a pit or a lake floor.
  brineFlush: finite.min(0).max(1).default(0.6),
  seepShare: finite.min(0).max(1).default(0.5),
  crustShare: finite.min(0).max(1).default(0.5),
  // Bed: share an exposed bed on wet ground dissolves back to brine per epoch, share an
  // exposed bed on bare ground loses to the wind, and the share of dust that settles per epoch.
  dissolveShare: finite.min(0).max(1).default(0.3),
  dustShare: finite.min(0).max(1).default(0.15),
  dustSettle: finite.min(0).max(1).default(0.5),
  // Bed per square metre that fuses the ground to glass, and the resistance it adds per epoch.
  glassBed: positive.default(800),
  glassResistance: finite.nonnegative().default(300),
  // Share of the air's moisture salted ground removes at full salting.
  desiccation: finite.min(0).max(1).default(0.5),
  // A buried bed under this much strain domes: metres risen per epoch, the bound, and the
  // share of the bed that seeps to the ring as brine.
  domeStrain: finite.min(0).max(1000).default(600),
  domeRise: finite.nonnegative().default(3),
  domeLimit: finite.nonnegative().default(60),
  domeSeep: finite.min(0).max(1).default(0.05),
  // Share of every Salt reservoir Fire at full intensity burns away per epoch.
  saltBurn: finite.min(0).max(1).default(0.8),
  // Hallowed: person-years per square metre at a seat that make a full source, the bonus a
  // seat earns per way converging on it, kept-years per square metre that make a full line,
  // and traveller-years per square metre that make a walked way a pilgrimage road.
  tenureFull: positive.default(2),
  pilgrimageBonus: finite.nonnegative().default(0.1),
  lineFull: positive.default(0.005),
  roadFull: positive.default(50),
  // The ring a full seat wards, metres, and the share of Aurora's stored charge that adds to
  // the field where the two meet.
  wardReach: positive.default(40_000),
  auroraReinforce: finite.min(0).max(1).default(0.3),
  // Resistance the first reach below a ward loses at full warding, per epoch.
  wardSpill: finite.nonnegative().default(200),
  // Veil: strain at which a tear forms and at which it is full; the change in a tear's
  // strength between epochs (as a share) that makes it wholly wild.
  tearFloor: finite.min(0).max(1).default(0.05),
  tearFull: finite.min(0).max(1).default(0.4),
  wildShift: finite.min(0).max(1).default(0.3),
  // Doors: the strength a stable tear needs, the least span between a pair's ends (metres),
  // the strength difference a pair tolerates, and the most doors a world holds.
  doorStrain: finite.min(0).max(1000).default(400),
  doorDistance: positive.default(300_000),
  doorMatch: finite.nonnegative().default(150),
  doorCount: z.number().int().nonnegative().default(6),
  // A wild zone moves its ground within this relief per epoch (metres) and exchanges this
  // share of its cover; a door chills its cell (native units), sinks a pool (metres) and
  // costs this much to cross (metres of travel).
  wildRelief: finite.nonnegative().default(20),
  wildShuffle: finite.min(0).max(1).default(0.3),
  doorChill: finite.nonnegative().default(30),
  doorPool: finite.nonnegative().default(3),
  doorTravel: positive.default(5000),
  // Verdure relaxes strain by this share at full verdure; salted ground holds a tear at this
  // share of its last strength at full salting.
  knitVerdure: finite.min(0).max(1).default(0.8),
  holdSalting: finite.min(0).max(1).default(1),
});
// Overrides carry no defaults of their own, so a reparse keeps an origin's overrides sparse.
const parameterOverrideSchema = z.object(
  Object.fromEntries(Object.keys(parameterSchema.shape).map((key) => [key, finite.optional()])) as {
    [K in keyof typeof parameterSchema.shape]: z.ZodOptional<typeof finite>;
  }
);
/** An amount of the system held in one reservoir per cell and moved by the named carriers. */
export const magicStockSchema = z.object({
  id: z.string().min(1),
  reservoir: z.string().min(1),
  carriers: z.array(z.enum(magicCarriers)).default([]),
});
/**
 * One way a system is created and spreads. A system holds one effect set and one rule set;
 * its origins differ in where they are located, how they propagate and how they renew.
 */
export const magicOriginSchema = z.object({
  id: z.string().min(1),
  source: z.enum(magicSources),
  propagation: z.enum(magicPropagations),
  renewal: z.enum(magicRenewals).default("continuous"),
  // Overrides of the system's parameters for this origin alone.
  parameters: parameterOverrideSchema.default({}),
  stocks: z.array(magicStockSchema).default([]),
});
export type MagicOrigin = z.infer<typeof magicOriginSchema>;
export type MagicStock = z.infer<typeof magicStockSchema>;

const legacyRenewal: Record<MagicSource, MagicRenewal> = {
  geothermal: "conduit-fed",
  cold: "accumulating",
  "deep-ocean": "continuous",
  placed: "kept",
  impact: "finite",
  verdant: "accumulating",
  aquifer: "continuous",
  forge: "accumulating",
  death: "accumulating",
  "dead-lake": "accumulating",
  tenure: "kept",
  "kept-line": "kept",
  strain: "emergent",
  pairing: "emergent",
};
const systemShape = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  // A system saved before origins existed names one source and one propagation; they
  // become its single origin and are dropped from the parsed system.
  source: z.enum(magicSources).optional(),
  propagation: z.enum(magicPropagations).optional(),
  origins: z.array(magicOriginSchema).default([]),
  // A society-phase system is evaluated when people have acted, each society cycle.
  phase: z.enum(["climate", "post-glacial", "society"]),
  strength: finite.nonnegative().default(1),
  parameters: parameterSchema.prefault({}),
  effects: z
    .object({
      heat: finite.default(0),
      iceMelt: finite.default(0),
      rockResistance: finite.default(0),
      coastalForcing: finite.nonnegative().default(0),
      // Fire: living processes run faster near the conduit; 0–1 at full intensity.
      quickening: finite.min(0).max(1).default(0),
      // Fire: conductance gained per epoch along an active conduit, in conductance units.
      conduitOpening: finite.min(0).max(1000).default(0),
      // Aurora: living processes slow and persist; 0–1 at full intensity.
      stillness: finite.min(0).max(1).default(0),
      // Aurora: share of ice ablation prevented by stored charge at full intensity; 0–1.
      icePersistence: finite.min(0).max(1).default(0),
      // Pressure: per-mille upwelling added where a ray shoals, per intensity unit.
      upwelling: finite.min(0).max(3).default(0),
      // Pressure: sea-surface temperature change per intensity unit on the upwelling band.
      seaSurface: finite.min(-1).max(1).default(0),
      // Pressure: sea-surface warming left in a wake, in native units (10 per °C).
      wakeWarming: finite.min(0).max(200).default(0),
      // Pressure: fog share on coasts facing an upwelling band; 0–1.
      fog: finite.min(0).max(1).default(0),
      // Pressure: storm energy a sharp warm front at sea sends inland on the wind; 0–1.
      storm: finite.min(0).max(1).default(0),
      // Greenwood: the life carried in sap and groundwater that grows forest past its
      // climate, deepens soil and braids rivers; 0–1 at full intensity.
      verdure: finite.min(0).max(1).default(0),
      // Salt: the preserving residue that thins cover, starves soil, turns grazers away and
      // dries the air over it; 0–1 at full intensity.
      salting: finite.min(0).max(1).default(0),
      // Hallowed: every other system is scaled down inside and the amount removed lands on
      // the rim; rivers and coasts hold inside. 0–1 at full intensity.
      warding: finite.min(0).max(1).default(0),
      // Veil: the ground tears where other systems strain against each other; 0–1.
      tearing: finite.min(0).max(1).default(0),
      vegetationGrowth: finite.min(-1).max(5).default(0),
      fire: finite.min(0).max(1).default(0),
      organicPreservation: finite.min(-3).max(3).default(0),
      animalToxicity: finite.min(0).max(1).default(0),
      seedDispersal: finite.min(-1).max(5).default(0),
    })
    .prefault({}),
  history: z
    .object({
      retention: finite.min(0).max(1).default(1),
      storage: finite.nonnegative().default(0),
      advect: z.boolean().default(true),
    })
    .prefault({}),
  features: z.array(magicFeatureSchema).default([]),
});
export const magicSystemSchema = systemShape
  .superRefine((system, context) => {
    if (!system.origins.length && !(system.source && system.propagation))
      context.addIssue({
        code: "custom",
        message: "A magic system needs at least one origin.",
        path: ["origins"],
      });
  })
  .transform(({ source, propagation, ...system }) => ({
    ...system,
    origins: system.origins.length
      ? system.origins
      : [
          {
            id: source!,
            source: source!,
            propagation: propagation!,
            renewal: legacyRenewal[source!],
            parameters: {},
            stocks: [],
          },
        ],
  }));
export type MagicSystem = z.infer<typeof magicSystemSchema>;
export type MagicSystemInput = z.input<typeof magicSystemSchema>;
export type MagicFeatureRule = z.infer<typeof magicFeatureSchema>;
export type MagicCondition = z.infer<typeof condition>;

/** The system's parameters with this origin's overrides applied. */
export function originParameters(system: MagicSystem, origin: MagicOrigin) {
  const merged = { ...system.parameters } as MagicSystem["parameters"];
  for (const [key, value] of Object.entries(origin.parameters))
    if (value !== undefined) (merged as Record<string, number>)[key] = value;
  return merged;
}

export const magicPhysicalFields = [
  "temperature",
  "ice",
  "elevation",
  "slope",
  "water",
  "moisture",
  "geothermal",
  "fracture",
  "landform",
  "river",
  "biome",
  "treeCover",
  "wetlandCover",
  "peatCarbon",
  "oilCarbon",
  "ecologicalToxicity",
  "soilWater",
  "soilDepth",
  "grazers",
  "browsers",
  "upwelling",
  "quickening",
  "stillness",
  "fog",
  "verdure",
  "noise",
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
  "wild",
  "scatter",
] as const;

function validateOrigins(system: MagicSystem) {
  const origins = new Set(system.origins.map((origin) => origin.id));
  if (origins.size !== system.origins.length)
    throw new Error(`Magic system ${system.id} needs distinct origin identities.`);
  for (const origin of system.origins)
    if (new Set(origin.stocks.map((stock) => stock.id)).size !== origin.stocks.length)
      throw new Error(`Origin ${origin.id} of ${system.id} needs distinct stock identities.`);
  return origins;
}
function knownConditionField(
  field: string,
  systems: Set<string>,
  origins: Set<string>,
  stocks: Set<string>
) {
  if (magicPhysicalFields.some((known) => known === field)) return true;
  if (field.startsWith("system:")) return systems.has(field.slice(7));
  if (field.startsWith("source:")) return origins.has(field.slice(7));
  if (field.startsWith("stock:")) return stocks.has(field.slice(6));
  return false;
}
/** The stock keys a system's rules may read: `<origin>/<stock>`, with `held` implied. */
export function systemStockKeys(system: MagicSystem) {
  return new Set(
    system.origins.flatMap((origin) =>
      (origin.stocks.length ? origin.stocks : [{ id: "held" }]).map(
        (stock) => `${origin.id}/${stock.id}`
      )
    )
  );
}
export function validateMagicSystems(systems: MagicSystem[]) {
  const ids = new Set(systems.map((system) => system.id));
  if (ids.size !== systems.length) throw new Error("Magic systems need distinct identities.");
  for (const system of systems) {
    const origins = validateOrigins(system),
      stocks = systemStockKeys(system);
    const conditions = system.features.flatMap((rule) =>
      [...rule.seeds, ...(rule.retains ?? [])].flat()
    );
    for (const test of conditions)
      if (!knownConditionField(test.field, ids, origins, stocks))
        throw new Error(`Unknown magic condition field: ${test.field}`);
  }
}
