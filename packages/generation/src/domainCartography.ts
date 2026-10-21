import { choice, type CartographicControl } from "./cartographicControls";

export const domainCartography: Record<string, CartographicControl> = {
  "magic.configured": {
    id: "configured-influences",
    label: "Configured influences",
    section: "environment",
    explanation:
      "Include the configured systems and their interactions in the shared generation history.",
    choices: [
      choice("off", "Omitted", { "magic.configured": { enabled: false } }),
      choice("on", "Configured systems", { "magic.configured": { enabled: true } }),
    ],
  },
  "ecology.living": {
    id: "living-cover",
    label: "Living cover",
    section: "environment",
    initialOnly: true,
    explanation:
      "Living communities respond to climate and history; productivity and grazing jointly influence their development.",
    choices: [
      choice("off", "Omitted", { "ecology.living": { enabled: false } }),
      choice("sparse", "Lower productivity", {
        "ecology.living": { enabled: true, settings: { vegetation: 0.4, grazing: 1.5 } },
      }),
      choice("productive", "Ordinary productivity", {
        "ecology.living": { enabled: true, settings: { vegetation: 1, grazing: 1 } },
      }),
      choice("high", "Higher productivity", {
        "ecology.living": { enabled: true, settings: { vegetation: 1.8, grazing: 0.6 } },
      }),
    ],
  },
  "human.cultures": {
    id: "cultural-geography",
    label: "Cultural geography",
    section: "people",
    explanation:
      "Starting cultures and their distributions; these do not define political borders. Existing regional identities are retained.",
    choices: [
      choice("none", "Omitted", { "human.cultures": { enabled: false } }),
      choice("few", "Few starting cultures", {
        "human.cultures": { enabled: true, settings: { cultureCount: 3 } },
      }),
      choice("many", "Many starting cultures", {
        "human.cultures": { enabled: true, settings: { cultureCount: 8 } },
      }),
    ],
  },
  "human.politics": {
    id: "political-geography",
    label: "Political geography",
    section: "people",
    explanation:
      "Starting polities, independently of cultures. Existing regional identities are retained.",
    choices: [
      choice("none", "Omitted", { "human.politics": { enabled: false } }),
      choice("few", "Few starting polities", {
        "human.politics": { enabled: true, settings: { polityCount: 3 } },
      }),
      choice("many", "Many starting polities", {
        "human.politics": { enabled: true, settings: { polityCount: 10 } },
      }),
    ],
  },
  "built.layout": {
    id: "places-and-routes",
    label: "Places and routes",
    section: "people",
    explanation:
      "Settlements and roads at world and region scale; finer profiles use their existing layout behavior.",
    choices: [
      choice("off", "Omitted", { "built.layout": { enabled: false } }),
      choice("on", "Generate places and connections", { "built.layout": { enabled: true } }),
    ],
  },
};
