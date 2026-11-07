import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { ProvinceSite } from "./provinceSites";
import type { TectonicSite } from "./tectonicState";
import { createProvinceSites } from "./provinceSites";
import { meshDeltaX } from "./mesh";
import { hashUnit } from "./noise";
import { tectonicInitialProvincesPerPlate, tectonicLocalDrivingShare } from "./tectonicControls";
import { provinceAreas } from "./provinceTerritories";

/** One founding province for each continent, then ocean provinces up to the world's plate count. */
function plateRoots(sites: ProvinceSite[], seed: number) {
  const ranked = sites
    .map((site, index) => ({ site, priority: hashUnit(seed ^ 0x7143, index, 0) }))
    // hpc-exempt: province site records, sorted once.
    .sort((a, b) => b.priority - a.priority)
    .map(({ site }) => site);
  const continents = [...new Set(sites.map((site) => site.assembly).filter((id) => id > 0))],
    founders = continents.map((id) => ranked.find((site) => site.assembly === id)!),
    count = Math.max(2, Math.round(sites.length / tectonicInitialProvincesPerPlate)),
    others = ranked.filter((site) => site.assembly === 0);
  return [...founders, ...others.slice(0, Math.max(0, count - founders.length))];
}
function nearestRoot(map: PhysicalField, roots: ProvinceSite[], site: ProvinceSite) {
  if (site.assembly > 0) return roots.findIndex((root) => root.assembly === site.assembly);
  let plate = 0,
    minimum = Infinity;
  roots.forEach((root, i) => {
    const distance = meshDeltaX(map.mesh, site.x - root.x) ** 2 + (site.y - root.y) ** 2;
    if (distance < minimum) {
      minimum = distance;
      plate = i;
    }
  });
  return plate;
}
/**
 * Plates form around continents: each continent starts whole on one plate with the ocean nearest it,
 * so plate edges mostly run through ocean. Later collisions and rifts change that.
 */
export function initialTectonicSites(map: PhysicalField, context: PhysicalContext): TectonicSite[] {
  const source = createProvinceSites(map, context),
    roots = plateRoots(
      source.filter((site) => site.oceanPlate === 0),
      context.EpochStableSeed
    );
  const areas = provinceAreas(source, map.mesh.bounds, map.mesh.periodic?.width ?? 0);
  return source.map((site, index) => {
    const plate = nearestRoot(map, roots, site),
      // An ocean plate has one driver and no differential strain, so it moves as one rigid plate.
      ocean = site.oceanPlate > 0,
      driver = ocean ? source.find((other) => other.oceanPlate === site.oceanPlate)! : roots[plate],
      share = ocean ? 0 : tectonicLocalDrivingShare;
    const driveX = driver.motionX * (1 - share) + site.motionX * share,
      driveY = driver.motionY * (1 - share) + site.motionY * share;
    return {
      ...site,
      id: index + 1,
      plate: ocean ? roots.length + site.oceanPlate : plate + 1,
      originX: site.x,
      originY: site.y,
      driveX,
      driveY,
      motionX: driveX,
      motionY: driveY,
      area: areas[index],
      mass: areas[index] * (site.assembly > 0 ? 4 : 1),
      compliance: 0,
      block: ocean ? roots.length + site.oceanPlate : plate + 1,
      pullX: 0,
      pullY: 0,
    };
  });
}
