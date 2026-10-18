import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { Feature } from "./codes";
import { seaIce } from "./seaIce";

// Canonry's seed is a frozen world and requests 42% sea-ice coverage. The atlas
// bounds that profile input by the ocean that can freeze under its authored
// temperature and magical forcing; the native suitability algorithm is unchanged.
export function atlasSeaIce(map: PhysicalField, c: PhysicalContext) {
  let ocean = 0,
    freezing = 0;
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    ocean++;
    if (map.Temperature[i] <= c.Profile.IceMarginTemperature) freezing++;
  }
  if (freezing === 0) {
    map.SeaIceSuitability.fill(0);
    for (let i = 0; i < map.mesh.count; i++) {
      map.FeatureFlags[i] &= ~(Feature.PermanentSeaIce | Feature.PermanentIceMargin);
      if (map.WaterKindCodes[i] === 1) map.IceThickness[i] = 0;
    }
    return;
  }
  const targets = c.Profile.QualityTargets;
  seaIce(map, {
    ...c,
    Profile: {
      ...c.Profile,
      QualityTargets: {
        ...targets,
        SeaIceCoverage: {
          ...targets.SeaIceCoverage,
          target: Math.min(targets.SeaIceCoverage.target, freezing / ocean),
        },
      },
    },
  });
}
