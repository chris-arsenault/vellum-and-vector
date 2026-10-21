import { choice, type CartographicControl } from "./cartographicControls";
import { rainfallRegimes } from "./atlasParameters";

const river = (mapped: boolean, incision: boolean, plains: boolean) => ({
  "physical.river-networks": { enabled: mapped },
  "physical.river-incision": {
    enabled: incision,
    ...(incision ? { settings: { erosion: 1 } } : {}),
  },
  "physical.floodplains": { enabled: plains },
  "physical.deltas": { enabled: plains },
});
const ice = (enabled: boolean, sculpting: boolean, strength = 1) => ({
  "physical.land-ice": { enabled },
  "physical.glacial-sculpting": {
    enabled: sculpting,
    ...(sculpting ? { settings: { glaciers: strength } } : {}),
  },
});

/** Latitude frames; each fills only the frame settings and leaves the world size alone. */
const frame = (south: number, north: number, wrapLongitude: number) => ({
  "physical.climate": {
    enabled: true,
    settings: { southLatitude: south, northLatitude: north, latitudeProjection: 1, wrapLongitude },
  },
});
const latitudeFrame: CartographicControl = {
  id: "latitude-frame",
  label: "Latitude frame",
  section: "environment",
  initialOnly: true,
  explanation:
    "Where the map sits between equator and poles, independent of its size. Latitudes use an equal-area spacing; a full globe wraps air and ocean east to west.",
  choices: [
    choice("northern-band", "Northern band · 10° to 70°", frame(10, 70, 0)),
    choice("hemispheres", "Two hemispheres · 70°S to 70°N", frame(-70, 70, 0)),
    choice("globe", "Full globe · pole to pole", frame(-90, 90, 1)),
  ],
};

export const physicalCartography: Record<string, CartographicControl | CartographicControl[]> = {
  "physical.foundation": {
    id: "land-arrangement",
    label: "Land arrangement",
    section: "land",
    initialOnly: true,
    explanation: "Starting continental crust, not a fixed final coastline or island count.",
    choices: [
      choice("mixed", "Mixed continents", {
        "physical.foundation": { settings: { continents: 4, landFraction: 0.48 } },
      }),
      choice("broad", "Broad continents", {
        "physical.foundation": { settings: { continents: 2, landFraction: 0.7 } },
      }),
      choice("islands", "Island world", {
        "physical.foundation": { settings: { continents: 12, landFraction: 0.25 } },
      }),
    ],
  },
  "physical.tectonic-history": {
    id: "tectonic-history",
    label: "Tectonic history",
    section: "land",
    initialOnly: true,
    explanation: "Coordinate crust movement and mountain building through the existing history.",
    choices: [
      choice("quiet", "Quiet crust", {
        "physical.tectonic-history": { enabled: false },
        "physical.mountains": { enabled: false },
      }),
      choice("moving", "Moving crust and mountains", {
        "physical.tectonic-history": { enabled: true, settings: { plateDrift: 1 } },
        "physical.mountains": { enabled: true },
      }),
    ],
  },
  "physical.volcanism": {
    id: "event-geography",
    label: "Geological events",
    section: "land",
    initialOnly: true,
    explanation:
      "Choose volcanic and impact construction together; tune their strengths separately only when needed.",
    choices: [
      choice("quiet", "Neither", {
        "physical.volcanism": { enabled: false },
        "physical.impacts": { enabled: false },
      }),
      choice("volcanic", "Volcanic terrain", {
        "physical.volcanism": { enabled: true, settings: { volcanism: 1 } },
        "physical.impacts": { enabled: false },
      }),
      choice("impacts", "Impact terrain", {
        "physical.volcanism": { enabled: false },
        "physical.impacts": { enabled: true, settings: { impacts: 6, impactSize: 1 } },
      }),
      choice("mixed", "Volcanoes and impacts", {
        "physical.volcanism": { enabled: true, settings: { volcanism: 1 } },
        "physical.impacts": { enabled: true, settings: { impacts: 6, impactSize: 1 } },
      }),
    ],
  },
  "physical.climate": [
    latitudeFrame,
    {
      id: "thermal-climate",
      label: "Thermal climate",
      section: "environment",
      explanation:
        "Baseline conditions; elevation, circulation, history and influences still shape local temperatures.",
      choices: [-5, 15, 30].map((temperature, index) =>
        choice(["cold", "temperate", "warm"][index], ["Cold", "Temperate", "Warm"][index], {
          "physical.climate": { enabled: true, settings: { temperature } },
        })
      ),
    },
  ],
  "water.routing": {
    id: "rainfall-regime",
    label: "Rainfall regime",
    section: "environment",
    explanation: "A rainfall influence, not uniform moisture or a prescribed biome map.",
    choices: Object.entries(rainfallRegimes).map(([id, regime]) =>
      choice(id, regime.label, {
        "physical.climate": { enabled: true, settings: { rainfall: regime.rainfall } },
      })
    ),
  },
  "ocean.geography": {
    id: "sea-level",
    label: "Sea level",
    section: "environment",
    initialOnly: true,
    explanation: "Adjust the connected ocean's initial reference by −150, 0 or +150 metres.",
    choices: [-150, 0, 150].map((seaLevel, index) =>
      choice(["lower", "reference", "higher"][index], ["Lower", "Reference", "Higher"][index], {
        "ocean.geography": { enabled: true },
        "physical.climate": { settings: { seaLevel } },
      })
    ),
  },
  "physical.river-networks": {
    id: "river-terrain",
    label: "River terrain",
    section: "environment",
    explanation:
      "Coordinate mapped channels, valley cutting, floodplains and deltas. Water balance stays available to the landscape.",
    choices: [
      choice("omitted", "No mapped rivers", river(false, false, false)),
      choice("channels", "Channels only", river(true, false, false)),
      choice("plains", "River plains", river(true, false, true)),
      {
        ...choice("incised", "Carved valleys and plains", river(true, true, true)),
        initialOnly: true,
      },
    ],
  },
  "physical.glacial-sculpting": {
    id: "glacial-influence",
    label: "Glacial influence",
    section: "environment",
    explanation:
      "Ice forms where the climate allows. Sculpting includes erosion and deposition as one behavior.",
    choices: [
      choice("none", "No land ice", ice(false, false)),
      choice("ice", "Ice without sculpting", ice(true, false)),
      choice("sculpted", "Glacial sculpting", ice(true, true)),
      choice("strong", "Stronger glacial sculpting", ice(true, true, 2)),
    ],
  },
  "physical.coastal-evolution": {
    id: "coastal-change",
    label: "Coastal change",
    section: "environment",
    initialOnly: true,
    explanation:
      "Coastal erosion and deposition through history; this is not a guaranteed shoreline shape.",
    choices: [
      choice("off", "Omitted", { "physical.coastal-evolution": { enabled: false } }),
      choice("ordinary", "Ordinary", {
        "physical.coastal-evolution": { enabled: true, settings: { coastalErosion: 1 } },
      }),
      choice("strong", "Stronger", {
        "physical.coastal-evolution": { enabled: true, settings: { coastalErosion: 2 } },
      }),
    ],
  },
};
