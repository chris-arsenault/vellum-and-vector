import { fieldInterpolator } from "@atlas/domain";
import type { GenerationState, MapProcess } from "../process";
import { generationBindings } from "../generationBindings";
import { parentChannels, nativePosition } from "./atlasWorkspace";
import { physicalContext } from "./context";
import { runoff, snowShare } from "./climate";
import { clamp } from "./math";
import type { PhysicalField } from "./field";
import type { NumericalVector } from "@atlas/domain";
import { workingValues, releaseWorking } from "./physicalNumerics";

/** Local windward/leeward contrast around the inherited broad weather. */
const regionalOrographicContrast = 0.35;
function exposure(map: PhysicalField, i: number, delta: NumericalVector) {
  const speed = Math.hypot(map.WindX[i], map.WindY[i]);
  if (speed === 0) return 0;
  let rise = 0,
    weight = 0;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const at = i * map.mesh.stride + edge,
      j = map.mesh.neighbors[at];
    if (j < 0) continue;
    const along = (map.mesh.edgeX[at] * map.WindX[i] + map.mesh.edgeY[at] * map.WindY[i]) / speed;
    rise += ((delta[j] - delta[i]) * along) / map.mesh.edgeLength[at];
    weight += Math.abs(along);
  }
  return weight ? rise / weight : 0;
}
export function downscaleRegionalClimate(state: GenerationState, seed: number) {
  const work = state.physical!,
    map = work.map,
    p = work.profile,
    parent = parentChannels(state).get("elevation");
  if (!parent) return;
  const height = fieldInterpolator(parent, "elevation"),
    delta = workingValues(
      map,
      "float64",
      "climate:relief",
      (i) => map.Elevation[i] / 1024 - height(nativePosition(work, i))
    );
  for (let i = 0; i < map.mesh.count; i++) {
    if (!state.surface.channels.temperature) map.Temperature[i] = p.TemperatureBaseline;
    map.Temperature[i] = clamp(
      map.Temperature[i] - (delta[i] * p.ElevationTemperatureLapse) / 1000,
      0,
      1000
    );
    const factor =
        1 + regionalOrographicContrast * Math.tanh(exposure(map, i, delta) / p.WindBlockingSlope),
      inheritedRain = state.surface.channels.rainfall || state.surface.channels.snowfall,
      total = clamp(
        (inheritedRain ? map.Rainfall[i] + map.Snowfall[i] : p.PrecipitationBaseline) * factor,
        0,
        p.PrecipitationCeiling
      ),
      snow = snowShare(p, map.Temperature[i], map.Seasonality[i] * 10) / 1000;
    map.Rainfall[i] = total * (1 - snow);
    map.Snowfall[i] = total * snow;
    map.Moisture[i] = clamp(map.Moisture[i] * factor, 0, 1000);
  }
  runoff(map, physicalContext(seed, 0, p));
  releaseWorking(map, delta);
}
export const regionalClimateProcess: MapProcess = {
  contract: {
    id: "regional.climate",
    version: "1",
    parameters: {},
    requires: ["canonry:workspace", "canonry:Elevation"],
    produces: ["Temperature", "Moisture", "Precipitation", "Runoff"].map(
      (fact) => `canonry:${fact}`
    ),
    invalidates: [],
    workspaceOnly: true,
  },
  behavior: {
    kind: "model-pass",
    applyPass(state, context) {
      context.progress(0, "Resolving climate against finer relief");
      downscaleRegionalClimate(state, generationBindings(context).seed);
      context.progress(1, "Regional climate and runoff ready");
    },
  },
  validate: () => [],
};
