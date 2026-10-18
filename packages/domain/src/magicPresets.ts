import { magicSystemSchema, type MagicCondition, type MagicFeatureRule } from "./magicSystems";

const at = (field: string, min: number): MagicCondition => ({ field, min });
const oneOf = (field: string, values: number[]): MagicCondition => ({ field, values });
const land = oneOf("water", [0, 2]);
const ocean = oneOf("water", [1]);
const feature = (
  id: string,
  name: string,
  priority: number,
  seeds: MagicCondition[][],
  retains?: MagicCondition[][]
): MagicFeatureRule => ({ id, name, priority, seeds, ...(retains ? { retains } : {}) });

// Canonry IceRemembers' three systems are data passed to the same process contracts.
const firePreset = magicSystemSchema.parse({
  id: "fire",
  name: "Fire",
  source: "geothermal",
  propagation: "fracture",
  phase: "climate",
  effects: { heat: 0.36, iceMelt: 0.5, rockResistance: 900 },
  features: [
    feature("core", "Fire core", 90, [[at("source", 1)]]),
    feature(
      "vein",
      "Thermal vein",
      20,
      [[land, at("intensity", 320), at("fracture", 430)]],
      [[land, at("intensity", 230), at("fracture", 320)]]
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
      [[land, at("intensity", 560), { field: "slope", max: 45 }]],
      [[land, at("intensity", 470), { field: "slope", max: 60 }]]
    ),
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
  source: "cold",
  propagation: "cold-drainage",
  phase: "post-glacial",
  effects: { rockResistance: -520 },
  features: [
    feature(
      "field",
      "Aurora field",
      40,
      [[at("intensity", 470), at("ice", 260)]],
      [[at("intensity", 380), at("ice", 180)]]
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
  source: "deep-ocean",
  propagation: "ocean-rays",
  phase: "post-glacial",
  effects: { coastalForcing: 1 },
  features: [
    feature("locus", "Deep pressure locus", 95, [[at("source", 1)]]),
    feature("crush", "Crush zone", 60, [[at("intensity", 360)]], [[at("intensity", 270)]]),
    feature("wake", "Ancient wake", 55, [[at("wake", 1)]]),
    feature(
      "lattice",
      "Interference lattice",
      35,
      [[at("intensity", 185), at("noise", 0.34)]],
      [[at("intensity", 95), at("noise", 0.28)]]
    ),
    feature("rogue", "Rogue wave impact", 50, [[at("rogue", 1)]]),
    feature("war", "Thermal war rim", 100, [[at("system:fire", 260), at("system:aurora", 340)]]),
    feature("steam", "Steam fracture", 110, [
      [at("system:fire", 390), at("intensity", 420), at("fracture", 520)],
    ]),
    feature("breach", "Pressure aurora breach", 120, [
      [at("intensity", 390), at("system:aurora", 430), ocean, at("ice", 220)],
    ]),
  ],
});
export function canonryMagicPresets() {
  return structuredClone([firePreset, auroraPreset, pressurePreset]);
}
