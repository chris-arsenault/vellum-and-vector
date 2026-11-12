import { respond } from "../coupling/answers";
import { clamp } from "../world/math";
import { atmosphericFlow } from "../world/atmosphere";
import { moisture, precipitation, temperature } from "../world/climate";
import { oceanCurrents } from "../world/currents";
import { bathymetry, oceanDistance } from "../world/geography";
import { initializeOceanBudget, oceanSurface, recordMarineConnections } from "../water/ocean";
import { seaIce } from "../world/seaIce";
import { warmthSources } from "../world/warmth";
import { fieldCommand, fieldQuery } from "./builder";
import { crustHeat } from "./crustProcesses";

/** Sea and sky: what the land stands in. They read the land, and move no material. */
const ground = "Elevation",
  sea = "WaterKindCodes";
export const oceanBudget = fieldCommand(
  "initialize",
  {
    id: "ocean-budget",
    statement: "Formation establishes the finite marine water budget once ground has formed.",
    needs: [ground],
    execute: ({ map, context }) => initializeOceanBudget(map, context),
  },
  []
);
export const oceanRead = fieldQuery(
  {
    id: "ocean-surface",
    statement: "The sea fills what its water reaches, at the level its volume comes to.",
    needs: [ground],
    provides: [sea, "WaterDepths", "WaterSurfaceElevations", "WaterBodyIds"],
    execute: ({ map, context }) => oceanSurface(map, context),
  },
  []
);
export const oceanMemory = fieldCommand(
  "event",
  {
    id: "marine-reconnection",
    statement: "Water reconnected to the ocean loses its isolated-basin memory.",
    needs: [ground],
    provides: [sea, "WaterDepths", "WaterSurfaceElevations", "WaterBodyIds"],
    execute: ({ map }) => recordMarineConnections(map),
  },
  [oceanRead]
);
export const shoreDistance = fieldQuery(
  {
    id: "ocean-distance",
    statement: "Each cell knows how far it lies from the sea.",
    needs: [sea],
    provides: ["OceanDistance"],
    execute: ({ map, context }) => oceanDistance(map, context),
  },
  [oceanRead]
);
export const seaFloorZones = fieldQuery(
  {
    id: "bathymetry",
    statement: "The sea floor is told apart into shelf, slope and deep by how it lies.",
    needs: [ground, sea],
    provides: ["BathymetricZoneCodes", "Slope"],
    execute: ({ map, context }) => bathymetry(map, context),
  },
  [oceanRead, shoreDistance]
);
export const currents = fieldQuery(
  {
    id: "ocean-currents",
    statement: "Wind and coasts turn the sea into gyres that carry heat and raise waves.",
    needs: [sea, "WaterDepths"],
    provides: ["OceanCurrentX", "OceanCurrentY", "OceanCurrentStrength", "WaveExposure"],
    execute: ({ map, context }) => oceanCurrents(map, context),
  },
  [oceanRead]
);
export const warmth = fieldQuery(
  {
    id: "warmth-sources",
    statement: "What warms the world beyond the sun is gathered where it lies.",
    needs: [ground, sea],
    provides: ["Warmth"],
    execute: ({ map, context }) => warmthSources(map, context),
  },
  [shoreDistance, currents, crustHeat]
);
/** Temperature includes the heat carried by air before any downstream reader observes it. */
export const atmosphere = fieldQuery(
  {
    id: "atmospheric-climate",
    statement: "Air carries heat and moisture across the terrain, then gives up rain and snow.",
    needs: [ground, sea],
    provides: [
      "Temperature",
      "Seasonality",
      "AirDemand",
      "WindX",
      "WindY",
      "WindSpeed",
      "UpwindTargets",
      "UpwindOceanSources",
      "MoistureBarriers",
      "PrecipitationBarriers",
      "Moisture",
      "ColumnPrecipitation",
      "StormTrack",
      "Rainfall",
      "Snowfall",
    ],
    execute: ({ map, context }) => {
      temperature(map, context);
      atmosphericFlow(map, context);
      moisture(map, context);
      precipitation(map, context);
    },
  },
  [oceanRead, shoreDistance, warmth]
);
export const seaFreezing = fieldCommand(
  "work",
  {
    id: "sea-ice",
    statement: "Cold sea freezes over where it can.",
    needs: [sea, "Temperature"],
    provides: ["SeaIceSuitability"],
    execute: ({ map, context }) => seaIce(map, context),
  },
  [oceanRead, atmosphere]
);

/** What climate answers of the ground. Temperature is ten native units per degree, freezing at 300. */
const freezing = 300,
  warm = 200,
  frostBand = 100;
respond({
  key: "warmth",
  by: "climate",
  reads: ["Temperature"],
  queries: [atmosphere.operation],
  base: (map, i) => Math.max(0, map.Temperature.get(i) - freezing) / warm,
});
// Ground that crosses freezing again and again is opened by frost, if it has water to freeze.
respond({
  key: "frost",
  by: "climate",
  reads: ["Temperature", "Rainfall"],
  queries: [atmosphere.operation],
  base: (map, i, { Profile: p }) =>
    clamp(1 - Math.abs(map.Temperature.get(i) - freezing) / frostBand, 0, 1) *
    clamp(map.Rainfall.get(i) / p.FluvialReferenceRunoff, 0, 1),
});

/** The sea's waves carry the energy their fetch and the current give them. */
respond({
  key: "waveEnergy",
  by: "sea",
  reads: ["WaveExposure"],
  queries: [currents.operation],
  base: (map, i) => map.WaveExposure.get(i),
});
