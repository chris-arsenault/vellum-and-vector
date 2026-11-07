// GeothermalLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, truncate } from "./math";
import { meshNoise as fractalNoise, meshUnitNoise as unitNoise } from "./noise";
import { Feature } from "./codes";

export function geothermal(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    let flags = map.FeatureFlags.get(i) & ~Feature.GeothermalVent;
    const tectonicStrain = map.TectonicStrain.get(i),
      fractureConductance = map.FractureConductance.get(i),
      volcanicActivity = map.VolcanicActivity.get(i),
      x = map.mesh.x(i),
      y = map.mesh.y(i);
    const strain = tectonicStrain / 1000;
    const boundary = [0, 0.43, 0.58, 0.24][map.TectonicBoundaryCodes.get(i)] * strain;
    const fracture = (fractureConductance / 1000) * 0.28;
    const impact =
      ((map.ImpactHeat.get(i) / 1000) * 0.36) / Math.max(1, map.CompletedEpochCount + 1);
    const lobes = fractalNoise(map.mesh, x, y, c.Seed ^ 0x4d13, c.Profile.PlumeLobeScale, 3);
    const plume =
      (volcanicActivity / 1000) *
      0.68 *
      clamp(1 + (lobes * c.Profile.PlumeLobeStrength) / 1000, 0, 1.6);
    const broad =
      unitNoise(map.mesh, x, y, c.Seed, Math.max(140_000, map.mesh.contentRadius * 0.34), 2) * 0.1;
    const geothermal = round(clamp(boundary + fracture + impact + plume + broad, 0, 1) * 1000);
    map.Geothermal.set(i, geothermal);
    map.HeatSourceDensity.set(
      i,
      clamp(
        truncate((geothermal * 2 + fractureConductance + tectonicStrain + volcanicActivity) / 4),
        0,
        1000
      )
    );
    const provenance =
      tectonicStrain >= 180 ||
      fractureConductance >= 560 ||
      volcanicActivity > 0 ||
      (flags & Feature.MantlePlume) !== 0;
    if (geothermal >= c.Profile.GeothermalVentThreshold && provenance)
      flags |= Feature.GeothermalVent;
    map.FeatureFlags.set(i, flags);
  }
}
