import { fieldInterpolator } from "@atlas/domain";
import type { GenerationState, MapProcess } from "../process";
import { generationBindings } from "../generationBindings";
import { parentChannels, nativePosition } from "./atlasWorkspace";
import { physicalContext } from "./context";
import { runoff, snowShare } from "./climate";
import { clamp } from "./math";
import type { PhysicalField } from "./field";
import type { Band } from "@atlas/domain";
import { workingValues, releaseWorking } from "./physicalNumerics";

/** Local windward/leeward contrast around the inherited broad weather. */
const regionalOrographicContrast = 0.35;
function exposure(map: PhysicalField, i: number, delta: Band) {
  const wx = map.WindX.get(i),
    wy = map.WindY.get(i),
    speed = Math.hypot(wx, wy);
  if (speed === 0) return 0;
  let rise = 0,
    weight = 0;
  const here = delta.get(i);
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0) continue;
    const along = (map.mesh.edgeX(i, edge) * wx + map.mesh.edgeY(i, edge) * wy) / speed;
    rise += ((delta.get(j) - here) * along) / map.mesh.edgeLength(i, edge);
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
      (i) => map.Elevation.get(i) / 1024 - height(nativePosition(work, i))
    );
  for (let i = 0; i < map.mesh.count; i++) {
    if (!state.surface.channels.temperature) map.Temperature.set(i, p.TemperatureBaseline);
    map.Temperature.set(
      i,
      clamp(map.Temperature.get(i) - (delta.get(i) * p.ElevationTemperatureLapse) / 1000, 0, 1000)
    );
    const factor =
        1 + regionalOrographicContrast * Math.tanh(exposure(map, i, delta) / p.WindBlockingSlope),
      inheritedRain = state.surface.channels.rainfall || state.surface.channels.snowfall,
      total = clamp(
        (inheritedRain ? map.Rainfall.get(i) + map.Snowfall.get(i) : p.PrecipitationBaseline) *
          factor,
        0,
        p.PrecipitationCeiling
      ),
      snow = snowShare(p, map.Temperature.get(i), map.Seasonality.get(i) * 10) / 1000;
    map.Rainfall.set(i, total * (1 - snow));
    map.Snowfall.set(i, total * snow);
    map.Moisture.set(i, clamp(map.Moisture.get(i) * factor, 0, 1000));
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
