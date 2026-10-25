import { magicSystemSchema } from "./magicSystems";
import { at, covers, feature, land, ocean, oneOf } from "./magicPresetHelpers";
import { hallowedPreset } from "./magicHallowedPreset";
import { veilPreset } from "./magicVeilPreset";

// Canonry IceRemembers' three systems are data passed to the same process contracts. The
// reach and rarity below are the atlas's own (docs/adr/0004): Canonry's defaults saturate
// a world this large, warm and oceanic.
const firePreset = magicSystemSchema.parse({
  id: "fire",
  name: "Fire",
  // Vein cores: fracture-hosted ore fed while the conduit is open, held in the rock and
  // carried with the crust. The fallen origin joins in M1c of docs/MAGIC-SYSTEMS-PLAN.md.
  origins: [
    {
      id: "vein",
      source: "geothermal",
      propagation: "fracture",
      renewal: "conduit-fed",
      stocks: [
        { id: "held", reservoir: "held", carriers: ["crust"] },
        // A sealed conduit's cores stay in the rock as hardened ore: carried with the crust,
        // exhumed by erosion, and washed into placers below.
        { id: "spent", reservoir: "spent", carriers: ["crust", "river"] },
      ],
    },
    // Fallen cores: meteoritic metal in the crust around a crater and in the gravels below,
    // a finite stock that cracking agents release and panning draws down.
    {
      id: "fallen",
      source: "impact",
      propagation: "local",
      renewal: "finite",
      stocks: [{ id: "held", reservoir: "held", carriers: ["crust", "river"] }],
    },
    // Forge cores: cores people mined and carried are cracked in a city's forges, and a
    // core releases where it is cracked. A city that imports cores becomes a Fire source.
    {
      id: "forge",
      source: "forge",
      propagation: "local",
      renewal: "accumulating",
      stocks: [{ id: "cracked", reservoir: "forge", carriers: ["crust", "people"] }],
    },
  ],
  phase: "climate",
  parameters: {
    // Cores sit on separated heat maxima under land: about one per 10,000 km² at most.
    sourceThreshold: 300,
    maximumSources: 96,
    sourceSpacing: 90_000,
    // Steep through unfractured rock (under 10 km), long along a conductive vein (60-120 km).
    baseCost: 3,
    conductanceDivisor: 12,
    conduitBudget: 2400,
  },
  effects: {
    heat: 0.36,
    iceMelt: 0.5,
    rockResistance: 900,
    fire: 0.3,
    quickening: 1,
    conduitOpening: 120,
  },
  features: [
    feature("core", "Fire core", 90, [[at("source", 1), at("intensity", 1)]]),
    feature(
      "vein",
      "Thermal vein",
      20,
      [[land, at("intensity", 320), at("fracture", 430)]],
      [[land, at("intensity", 230), at("fracture", 320)]],
      covers(230, 800)
    ),
    feature(
      "spring",
      "Hot spring",
      70,
      [
        ...[oneOf("water", [2]), at("river", 1), at("moisture", 650)].map((wet) => [
          land,
          at("intensity", 430),
          wet,
        ]),
        [land, at("geothermal", 720), at("temperature", 335), at("moisture", 260)],
      ],
      [
        ...[oneOf("water", [2]), at("river", 1), at("moisture", 560)].map((wet) => [
          land,
          at("intensity", 340),
          wet,
        ]),
        [land, at("geothermal", 650), at("temperature", 300), at("moisture", 220)],
      ]
    ),
    feature(
      "vent",
      "Hydrothermal vent",
      65,
      [
        [ocean, at("intensity", 430)],
        [ocean, at("geothermal", 720)],
      ],
      [
        [ocean, at("intensity", 340)],
        [ocean, at("geothermal", 630)],
      ]
    ),
    feature(
      "basalt",
      "Basalt flat",
      25,
      [[land, at("intensity", 560), { field: "slope", max: 0.0045 }]],
      [[land, at("intensity", 470), { field: "slope", max: 0.006 }]]
    ),
    // A conduit that carried Fire to exhaustion: sinter and basalt, cold, and a site for ruins.
    feature("scar", "Basalt scar", 30, [[land, at("sealed", 1)]]),
    // The fallen field: a crater lake over the stock, the barren fan around it, the gravel
    // bands below it, and the compass that swings wherever its metal lies.
    feature("crater", "Crater lake", 85, [[oneOf("water", [2]), at("stock:fallen/held", 1)]]),
    feature("fan", "Ejecta fan", 28, [[land, at("source:fallen", 1)]]),
    feature(
      "placer",
      "Placer band",
      60,
      [[land, at("river", 1), at("stock:fallen/held", 1)]],
      [[land, at("river", 1), at("stock:fallen/held", 0.2)]]
    ),
    feature("deviation", "Compass deviation", 5, [[at("stock:fallen/held", 0.5)]]),
    feature(
      "halo",
      "Thawed halo",
      10,
      [[land, at("intensity", 210), at("temperature", 250)]],
      [
        [
          land,
          at("intensity", 140),
          at("temperature", 225),
          at("fracture", 170),
          { field: "scatter", salt: 0x3f19, index: 0x5b1, min: 0.14 },
        ],
      ]
    ),
  ],
});
const auroraPreset = magicSystemSchema.parse({
  id: "aurora",
  name: "Aurora",
  // Charge in the ice rides the glaciers; what thaws stays in the ground and travels with
  // the crust; what the ice dropped lies in the moraines; what calved sits on the shelves.
  origins: [
    {
      id: "field",
      source: "cold",
      propagation: "cold-drainage",
      renewal: "accumulating",
      stocks: [
        { id: "ice", reservoir: "ice", carriers: ["ice"] },
        { id: "ground", reservoir: "ground", carriers: ["crust"] },
        { id: "moraine", reservoir: "moraine", carriers: ["crust"] },
        { id: "shelf", reservoir: "shelf", carriers: ["current"] },
      ],
    },
  ],
  phase: "post-glacial",
  effects: {
    rockResistance: -520,
    // Charged ice exhales cold air; the shadow is a few degrees, not a new ice age.
    heat: -0.03,
    stillness: 1,
    icePersistence: 0.9,
    // Stillness is the only growth term; preservation is what the cold leaves behind.
    organicPreservation: 1.5,
  },
  // Charge stored in ice outlasts the cold epoch that gathered it, so relict fields
  // survive a warm present on the ground that held the most.
  history: { retention: 0.3, storage: 0.5 },
  features: [
    feature(
      "field",
      "Aurora field",
      40,
      [[at("intensity", 470), at("ice", 260)]],
      [[at("intensity", 380), at("ice", 180)]],
      covers(380, 900)
    ),
    feature(
      "well",
      "Light well",
      80,
      [[at("intensity", 680), oneOf("landform", [10, 4])]],
      [[at("intensity", 590), oneOf("landform", [10, 4, 3])]]
    ),
    feature(
      "prism",
      "Frost prism",
      45,
      [[at("intensity", 510), oneOf("landform", [6, 5])]],
      [
        [
          at("intensity", 420),
          oneOf("landform", [6, 5]),
          { field: "scatter", salt: 0x77aa, index: 0x1d3, min: 0.25 },
        ],
      ]
    ),
    feature(
      "melt",
      "Melt line",
      15,
      [
        [
          at("intensity", 650),
          { field: "ice", min: 80, max: 360 },
          { field: "temperature", min: 275, max: 380 },
        ],
      ],
      [
        [
          at("intensity", 560),
          { field: "ice", min: 50, max: 430 },
          { field: "temperature", min: 240, max: 420 },
        ],
      ]
    ),
  ],
});
const pressurePreset = magicSystemSchema.parse({
  id: "pressure",
  name: "Pressure",
  origins: [
    { id: "locus", source: "deep-ocean", propagation: "ocean-rays", renewal: "continuous" },
  ],
  // Rays are set once the ocean has its geometry, so the epoch's later climate passes
  // see the water they move.
  phase: "climate",
  parameters: {
    // Rays separate into visible spokes beyond about 200 km and fade within a basin.
    rayCount: 128,
    rayDistance: 2_000_000,
    rayDecay: 8,
    rayIntensity: 110,
    beamWidth: 20_000,
    coastalSources: 24,
    coastalRayDistance: 300_000,
    coastalSourceDistance: 100_000,
    wakeSources: 16,
    wakeDistance: 700_000,
    wakeStrength: 150,
  },
  effects: {
    coastalForcing: 1,
    upwelling: 1,
    seaSurface: -0.1,
    wakeWarming: 30,
    fog: 0.8,
    // A warm wake under cold air raises a storm that carries the sea's weather inland.
    storm: 0.7,
    animalToxicity: 0.5,
  },
  features: [
    feature("locus", "Deep pressure locus", 95, [[at("source", 1)]]),
    feature("crush", "Crush zone", 60, [[at("intensity", 360)]], [[at("intensity", 270)]]),
    // A ray that shoals lifts cold deep water: the fishery and the fog coast.
    feature(
      "front",
      "Upwelling front",
      58,
      [[ocean, at("intensity", 250), at("upwelling", 250)]],
      [[ocean, at("intensity", 160), at("upwelling", 160)]],
      covers(160, 700)
    ),
    feature("wake", "Ancient wake", 55, [[at("wake", 1)]]),
    feature(
      "lattice",
      "Interference lattice",
      35,
      [[at("intensity", 185), at("noise", 0.34)]],
      [[at("intensity", 95), at("noise", 0.28)]]
    ),
    feature("rogue", "Rogue wave impact", 50, [[at("rogue", 1)]]),
    // The meetings with Fire and Aurora (Shatter rim, Boiling shore, Breach) are confluences
    // in the shared list, not rules of this system: see canonryConfluencePresets.
  ],
});
// Greenwood: life carried in sap and groundwater. Old stands and deep peat are one origin,
// springs on soft rock below a catchment the other; it spreads through connected cover and
// cannot cross bare rock, open water or ice. Reach and rarity are the atlas's (ADR 0004).
const greenwoodPreset = magicSystemSchema.parse({
  id: "greenwood",
  name: "Greenwood",
  origins: [
    {
      id: "stand",
      source: "verdant",
      propagation: "roots",
      renewal: "accumulating",
      stocks: [
        { id: "sap", reservoir: "sap", carriers: ["animal", "people"] },
        { id: "stratum", reservoir: "stratum", carriers: ["crust"] },
      ],
    },
    {
      id: "spring",
      source: "aquifer",
      propagation: "local",
      renewal: "continuous",
      stocks: [{ id: "aquifer", reservoir: "aquifer", carriers: ["groundwater"] }],
    },
  ],
  phase: "post-glacial",
  parameters: { baseCost: 2 },
  // Greenwood acts on the living through verdure alone, its own medium: no generic growth term.
  effects: { verdure: 1 },
  history: { retention: 0.6, storage: 0.4 },
  features: [
    feature(
      "stand",
      "Old stand",
      40,
      [[land, at("source:stand", 1), at("intensity", 300)]],
      undefined,
      covers(300, 900)
    ),
    // The rule is the wellspring; "spring" is Fire's hot spring in the palette and geometry.
    feature("wellspring", "Greenwood spring", 80, [[land, at("source:spring", 1)]]),
    // A spring on bare ground: the oasis that next epoch's roots carry on from.
    feature("oasis", "Oasis", 85, [
      [land, at("source:spring", 1), { field: "treeCover", max: 0.12 }],
    ]),
    feature(
      "verdant",
      "Verdant country",
      15,
      [[land, at("intensity", 250), at("verdure", 0.2)]],
      [[land, at("intensity", 150), at("verdure", 0.1)]],
      covers(150, 800)
    ),
    // A spring drawn past its recharge: the karst beneath it fell in.
    feature("sinkhole", "Sinkhole field", 70, [[land, at("sealed", 1), at("source:spring", 0)]]),
  ],
});
/** Brine, bed and dust: the one material of Salt, in each origin's own reservoirs. */
const saltStocks = () => [
  { id: "brine", reservoir: "brine", carriers: ["crust"] },
  { id: "bed", reservoir: "bed", carriers: ["crust", "wind", "people"] },
  { id: "dust", reservoir: "dust", carriers: ["wind"] },
];
const saltPreset = magicSystemSchema.parse({
  id: "salt",
  name: "Salt",
  // The dead the ground records become brine where they lie; a lake that died in a closed
  // basin leaves its bed. Both seep, crust, blow and ride the crust as one material.
  origins: ["death", "dead-lake"].map((id) => ({
    id,
    source: id,
    propagation: "brine",
    renewal: "accumulating",
    stocks: saltStocks(),
  })),
  phase: "post-glacial",
  parameters: {},
  // Salt acts on the living through salting alone: thinning, infertility, avoidance, drying.
  effects: { salting: 1 },
  // Salt does not decay; what is not flushed or burned is still there next epoch.
  history: { retention: 1, storage: 0.2 },
  features: [
    // Where the dead lie: the brine of the killing and the bed it crusts to.
    feature(
      "ground",
      "Killing ground",
      60,
      [
        [land, at("stock:death/brine", 5)],
        [land, at("stock:death/bed", 5)],
      ],
      undefined,
      covers(50, 800)
    ),
    feature("pan", "Salt pan", 55, [[land, at("intensity", 200)]], undefined, covers(200, 900)),
    // Bed deep enough to fuse the ground: the flat that mirages stand on.
    feature("flat", "Glass flat", 90, [
      [land, at("stock:dead-lake/bed", 800)],
      [land, at("stock:death/bed", 800)],
    ]),
    feature(
      "dust",
      "Salt dust",
      30,
      [
        [land, at("stock:death/dust", 10)],
        [land, at("stock:dead-lake/dust", 10)],
      ],
      undefined,
      { field: "intensity", floor: 20, full: 400 }
    ),
  ],
});
export function canonryMagicPresets() {
  return structuredClone([
    firePreset,
    auroraPreset,
    pressurePreset,
    greenwoodPreset,
    saltPreset,
    hallowedPreset,
    veilPreset,
  ]);
}
