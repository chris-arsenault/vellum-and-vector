import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { TectonicSite } from "./tectonicState";
import { createProvinceSites } from "./provinceSites";
import { meshDeltaX } from "./mesh";
import { hashUnit } from "./noise";
import { tectonicInitialProvincesPerPlate, tectonicLocalDrivingShare } from "./tectonicControls";
import { provinceTerritories } from "./provinceTerritories";
import { worldCandidates } from "./worldSources";

/** Mechanical territories are sampled independently of continental material origins. */
export function initialTectonicSites(map: PhysicalField, context: PhysicalContext): TectonicSite[] {
  const source = createProvinceSites(map, context),
    count = Math.max(2, Math.round(source.length / tectonicInitialProvincesPerPlate));
  const roots = source
    .map((site, index) => ({
      site,
      index,
      priority: hashUnit(context.EpochStableSeed ^ 0x7143, index, 0),
    }))
    // hpc-exempt: province site records, sorted once.
    .sort((a, b) => b.priority - a.priority)
    .slice(0, count);
  const samples = worldCandidates(map.mesh, context.EpochStableSeed, source.length * 24);
  const { areas } = provinceTerritories(source, samples, map.mesh.periodic?.width ?? 0);
  const bounds = map.mesh.bounds;
  const sampleArea = ((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) / samples.length;
  return source.map((site, index) => {
    let plate = 0,
      minimum = Infinity;
    roots.forEach(({ site: root }, i) => {
      const distance = meshDeltaX(map.mesh, site.x - root.x) ** 2 + (site.y - root.y) ** 2;
      if (distance < minimum) {
        minimum = distance;
        plate = i;
      }
    });
    const driver = roots[plate].site,
      share = tectonicLocalDrivingShare;
    const driveX = driver.motionX * (1 - share) + site.motionX * share,
      driveY = driver.motionY * (1 - share) + site.motionY * share;
    return {
      ...site,
      id: index + 1,
      plate: plate + 1,
      originX: site.x,
      originY: site.y,
      driveX,
      driveY,
      motionX: driveX,
      motionY: driveY,
      area: areas[index] * sampleArea,
      mass: areas[index] * sampleArea * (site.assembly > 0 ? 4 : 1),
      compliance: 0,
    };
  });
}
