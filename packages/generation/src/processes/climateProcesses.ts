import { atmosphericFlow } from "../world/atmosphere";
import { moisture, precipitation, temperature } from "../world/climate";
import { oceanCurrents } from "../world/currents";
import { bathymetry, landmasses, oceanDistance } from "../world/geography";
import { oceanConnectivity } from "../world/ocean";
import { seaIce } from "../world/seaIce";
import { warmthSources } from "../world/warmth";
import { builder } from "./builder";

/** Sea and sky: what the land stands in. They read the land, and move no material. */
const ground = "Elevation",
  sea = "WaterKindCodes";
export const oceanFill = builder({
  id: "ocean-connectivity",
  statement: "The sea fills what its water reaches, at the level its volume comes to.",
  needs: [ground],
  provides: [sea, "WaterDepths", "WaterSurfaceElevations", "WaterBodyIds"],
  build: oceanConnectivity,
});
export const shoreDistance = builder({
  id: "ocean-distance",
  statement: "Each cell knows how far it lies from the sea.",
  needs: [sea],
  provides: ["OceanDistance"],
  build: oceanDistance,
});
export const seaFloorZones = builder({
  id: "bathymetry",
  statement: "The sea floor is told apart into shelf, slope and deep by how it lies.",
  needs: [ground, sea],
  provides: ["BathymetricZoneCodes", "Slope"],
  build: bathymetry,
});
export const landBodies = builder({
  id: "landmasses-and-shelf-groups",
  statement: "Land is told apart into continents and islands, with the shelves that join them.",
  needs: [ground, sea],
  provides: ["LandmassIds", "LandmassClassCodes", "ContinentalGroupIds"],
  build: landmasses,
});
export const currents = builder({
  id: "ocean-currents",
  statement: "Wind and coasts turn the sea into gyres that carry heat and raise waves.",
  needs: [sea, "WaterDepths"],
  provides: ["OceanCurrentX", "OceanCurrentY", "OceanCurrentStrength", "WaveExposure"],
  build: oceanCurrents,
});
export const warmth = builder({
  id: "warmth-sources",
  statement: "What warms the world beyond the sun is gathered where it lies.",
  needs: [ground, sea],
  provides: ["Warmth"],
  build: warmthSources,
});
export const airTemperature = builder({
  id: "temperature",
  statement: "Temperature follows latitude and height, the sea's heat and what warms the ground.",
  needs: [ground, sea],
  provides: ["Temperature", "Seasonality"],
  build: temperature,
});
export const winds = builder({
  id: "atmospheric-flow",
  statement: "Winds blow by belt and are turned and blocked by the land.",
  needs: [ground, sea],
  provides: ["WindX", "WindY", "UpwindTargets", "MoistureBarriers", "PrecipitationBarriers"],
  build: atmosphericFlow,
});
export const airMoisture = builder({
  id: "moisture-transport",
  statement: "Air takes up water over the sea and carries it inland until it falls.",
  needs: [ground, sea, "Temperature", "UpwindTargets"],
  provides: ["Moisture", "ColumnPrecipitation"],
  build: moisture,
});
export const rainfall = builder({
  id: "precipitation",
  statement: "What the air gives up falls as rain or snow by how warm it is.",
  needs: ["Temperature", "ColumnPrecipitation"],
  provides: ["Rainfall", "Snowfall"],
  build: precipitation,
});
export const seaFreezing = builder({
  id: "sea-ice",
  statement: "Cold sea freezes over where it can.",
  needs: [sea, "Temperature"],
  provides: ["SeaIceSuitability"],
  build: seaIce,
});
