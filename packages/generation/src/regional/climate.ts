import {
  altitudeTemperature,
  climateTemperatureForcing,
  fogPrecipitation,
  partitionPrecipitation,
  seasonality,
  snowShare,
} from "../world/climate";
import { contributeForcing } from "../world/atlasForcing";
import { environment } from "../world/ecologyEnvironment";
import { latitudeAt } from "../world/latitude";
import { releaseWorking } from "../world/physicalNumerics";
import { deflectWind, windTerrain } from "../world/windTerrain";
import { physicalProfile, type PhysicalProfile } from "../world/profile";
import { isContent } from "./lattice";
import { heightGradients } from "./relief";
import { clamp, naturalBand, type RegionalState } from "./state";
import { atmosphere as atmosphericClimate } from "../processes/climateProcesses";
import { bindOperation, readOperation, runOperation, type Query } from "../processOperation";
import { processOwner, type MapInput } from "../processTraits";
import type { MapProcessContext } from "../process";

/** Native consumers and regional scheduling ask the same selected atmospheric owner. */
export function bindRegionalClimate(
  state: RegionalState,
  context: MapProcessContext,
  atmosphere: Query<MapInput>
) {
  const map = state.physical.map;
  bindOperation(map, atmosphericClimate.operation, () =>
    readOperation(map, atmosphere, { state, context })
  );
}

/** Atmospheric moisture change with altitude, resolved against the world's atmospheric frame. */
const moistureHeight = MapScale.length(0.0000025);
/** Warming of a fully sun-exposed slope, and cooling of a fully pooled floor (°C). */
const aspectTemperature = 3,
  poolingTemperature = 4;

/** Current environmental contributions replace their captured counterparts. */
const capturedForcing = new WeakMap<
  RegionalState,
  {
    temperature: Float64Array;
    precipitation: Float64Array;
    lengths: ReturnType<typeof atmosphericLengths>;
  }
>();

/** A child inherits the world's atmosphere; changing its working frame cannot shrink that atmosphere. */
export function atmosphericLengths(
  profile: Pick<PhysicalProfile, "WorldExtentX" | "WorldExtentY">,
  cellSpan: number
) {
  const x = profile.WorldExtentX,
    y = profile.WorldExtentY;
  requireThat(x && y, "regional_atmosphere", "Inherited atmosphere requires the world frame.");
  const scale = MapScale.fromBounds([x[0], y[0], x[1], y[1]], cellSpan);
  return {
    elevation: scale.resolveMeasure(physicalProfile.values.ElevationScale),
    continentality: scale.resolveMeasure(physicalProfile.values.ContinentalityDistance),
    moisture: scale.resolveMeasure(moistureHeight),
    fogDrip: scale.resolveMeasure(physicalProfile.values.FogDrip),
  };
}

/** Pin atmospheric inputs before the child's first local development or magic reevaluation. */
export function prepareClimate(state: RegionalState) {
  if (capturedForcing.has(state)) return;
  for (const name of [
    "Temperature",
    "Rainfall",
    "Snowfall",
    "Moisture",
    "WindX",
    "WindY",
    "OceanDistance",
  ] as const)
    naturalBand(state, name);
  const { map, profile } = state.physical,
    lengths = atmosphericLengths(profile, map.scale.cellSpan);
  capturedForcing.set(state, {
    lengths,
    temperature: Float64Array.from(
      { length: map.mesh.count },
      (_, i) => climateTemperatureForcing(map, profile, i) / 10
    ),
    precipitation: Float64Array.from({ length: map.mesh.count }, (_, i) =>
      fogPrecipitation(map.FogForcing.get(i), lengths.fogDrip)
    ),
  });
  runOperation(processOwner(state), contributeForcing, { state });
}

/** Replace captured environmental heating, then respond to the newly resolved local terrain. */
export function temperatureFromCapture(
  captured: number,
  previousHeat: number,
  currentHeat: number,
  terrainChange: number
) {
  return captured - previousHeat + currentHeat + terrainChange;
}

/** Slope exposure changes atmospheric rain; current fog replaces the old fog's separate supply. */
export function precipitationFromCapture(
  captured: number,
  previousFog: number,
  currentFog: number,
  rainFactor: number
) {
  return Math.max(0, Math.max(0, captured - previousFog) * rainFactor + currentFog);
}

/**
 * Local conditions on the developed relief. Each round derives the shared climate bands from
 * their captured copies: the lapse of new height, the slope's exposure to the sun, the cold
 * pooled in hollows and exposure to the captured wind. Magic's heat
 * and drying sit on top as the workspace's own replaced contribution and the ledger's
 * totals, so a second evaluation changes what changed and nothing else. Precipitation is
 * re-split into rain and snow by the new temperature with the world's own rule. Bands keep
 * their native units: temperature in tenths of a degree above -30 °C, rainfall, snowfall and
 * runoff in millimetres a year and moisture per mille. Soil and groundwater stay with their
 * shared elapsed owners; a climate read never replenishes them from captured values.
 */
export function respondClimate(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    moisture = naturalBand(state, "Moisture"),
    applied = state.regional.contributions;
  deflectCapturedWind(state);
  const { gx, gy } = heightGradients(state);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const delta = MapScale.metres(
        map.Elevation.get(i) - state.regional.inheritedHeight.get(i),
        "native"
      ),
      exposure = MapScale.metres(gx[i] * map.WindX.get(i) + gy[i] * map.WindY.get(i), "mm"),
      rainFactor = 1 + 0.35 * Math.tanh(exposure / 0.01);
    map.Temperature.set(i, nativeTemperature(localTemperature(state, i, delta)));
    splitPrecipitation(state, i, rainFactor);
    map.Moisture.set(
      i,
      Math.round(
        clamp(
          moisture.get(i) * rainFactor -
            delta / capturedForcing.get(state)!.lengths.moisture +
            applied.appliedTo("Moisture", i),
          0,
          1000
        )
      )
    );
  }
}

/** The captured temperature in °C at a cell. */
export function capturedCelsius(state: RegionalState, i: number) {
  return naturalBand(state, "Temperature").get(i) / 10 - 30;
}
/** Current magic heat in °C; the shared feedback owns this contribution. */
export function magicHeat(state: RegionalState, i: number) {
  return state.physical.map.ExternalHeatForcing.get(i) / 10;
}

/** Captured temperature lapsed by the height gained, with aspect, pooling, magic and the ledger (°C). */
function localTemperature(state: RegionalState, i: number, delta: number) {
  const media = state.regional.media,
    sun = media ? media.insolation[i] * aspectTemperature : 0,
    pooled = media ? media.pooling[i] * poolingTemperature : 0;
  return temperatureFromCapture(
    capturedCelsius(state, i),
    capturedForcing.get(state)!.temperature[i],
    climateTemperatureForcing(state.physical.map, state.physical.profile, i) / 10,
    -altitudeTemperature(
      delta,
      state.physical.profile.ElevationTemperatureLapse,
      capturedForcing.get(state)!.lengths.elevation
    ) /
      10 +
      sun -
      pooled +
      state.regional.contributions.appliedTo("Temperature", i) / 10
  );
}
const nativeTemperature = (celsius: number) => Math.round((celsius + 30) * 10);

/**
 * The captured wind deflected by the developed relief with the world's own rule (valley
 * channelling, lee turning), written each round from the captured direction so a change in
 * relief updates the wind rather than turning it further each round.
 */
function deflectCapturedWind(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    profile = state.physical.profile,
    windX = naturalBand(state, "WindX"),
    windY = naturalBand(state, "WindY"),
    terrain = windTerrain(map, profile);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const x = MapScale.metres(windX.get(i), "mm"),
      y = MapScale.metres(windY.get(i), "mm"),
      speed = Math.hypot(x, y);
    if (speed === 0) continue;
    const [dx, dy] = deflectWind(terrain, profile, i, x / speed, y / speed);
    map.WindX.set(i, Math.round(MapScale.inUnits(dx * speed, "mm")));
    map.WindY.set(i, Math.round(MapScale.inUnits(dy * speed, "mm")));
  }
  releaseWorking(map, terrain.terrain, terrain.gradientX, terrain.gradientY, terrain.height);
}

/**
 * The captured precipitation, changed by exposure and the ledger, falls as snow for the share
 * of the year the world's rule gives at the new temperature and this latitude's seasonal
 * range (continentality from the distance to the sea).
 */
function splitPrecipitation(state: RegionalState, i: number, rainFactor: number) {
  const map = state.physical.map,
    profile = state.physical.profile,
    applied = state.regional.contributions,
    total = Math.max(
      0,
      precipitationFromCapture(
        naturalBand(state, "Rainfall").get(i) + naturalBand(state, "Snowfall").get(i),
        capturedForcing.get(state)!.precipitation[i],
        fogPrecipitation(map.FogForcing.get(i), capturedForcing.get(state)!.lengths.fogDrip),
        rainFactor
      ) +
        applied.appliedTo("Rainfall", i) +
        applied.appliedTo("Snowfall", i)
    ),
    distance = map.OceanDistance.get(i),
    continentality =
      map.WaterKindCodes.get(i) === 1 || distance < 0
        ? 0
        : distance / capturedForcing.get(state)!.lengths.continentality,
    halfRange = seasonality(profile, latitudeAt(profile, map, i), continentality);
  map.Seasonality.set(i, halfRange);
  const { snowfall, rainfall } = partitionPrecipitation(
    total,
    snowShare(profile, map.Temperature.get(i), halfRange * 10)
  );
  map.Snowfall.set(i, snowfall);
  map.Rainfall.set(i, rainfall);
}

/** Present temperature in °C. */
export function celsius(state: RegionalState, i: number) {
  return state.physical.map.Temperature.get(i) / 10 - 30;
}
/** Rain plus snow (m/yr). */
export function regionalPrecipitation(state: RegionalState, i: number) {
  const map = state.physical.map;
  return MapScale.metres(map.Rainfall.get(i) + map.Snowfall.get(i), "mm");
}
/** Present plant-water availability: shared seasonal climate and the actual retained soil water. */
export function regionalMoisture(state: RegionalState, i: number) {
  return 1 - environment(state.physical.map, i).drought;
}
import { MapScale, requireThat } from "@atlas/domain";
