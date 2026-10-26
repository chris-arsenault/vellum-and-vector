import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { ProvinceSite } from "./provinceSites";
import { initialTectonicSites } from "./tectonicInitialization";
import { provinceTerritories } from "./provinceTerritories";
import { meshDeltaX, meshPoint } from "./mesh";
import { hashUnit } from "./noise";
import { tectonicReferenceMyr } from "./tectonicControls";
import { refreshSiteMotion, moveTectonicPoint } from "./tectonicMotion";

export interface TectonicSite extends ProvinceSite {
  id: number;
  plate: number;
  originX: number;
  originY: number;
  driveX: number;
  driveY: number;
  mass: number;
  area: number;
  compliance: number;
}
export interface TectonicPlate {
  id: number;
  x: number;
  y: number;
  motionX: number;
  motionY: number;
  /** Angular velocity per metre of the normalized displacement interval. */
  spin: number;
}
export interface TectonicBond {
  a: number;
  b: number;
  strength: number;
  extension: number;
  shortening: number;
  broken: boolean;
  active: boolean;
}
export interface TectonicState {
  sites: TectonicSite[];
  plates: TectonicPlate[];
  bonds: TectonicBond[];
  nextPlateId: number;
  elapsedMyr: number;
  splits: number;
  welds: number;
  rate: number;
  seed: number;
  bondLookup: Int32Array;
  transitions: { kind: "split" | "weld"; atMyr: number; plates: number[]; sites: number[] }[];
}

export function plateOf(map: PhysicalField, sites: TectonicSite[], id: number): TectonicPlate {
  const members = sites.filter((site) => site.plate === id),
    root = members[0];
  const mass = members.reduce((sum, site) => sum + site.mass, 0);
  const mean = (value: (site: TectonicSite) => number) =>
    members.reduce((sum, site) => sum + value(site) * site.mass, 0) / mass;
  const [x, y] = meshPoint(
    map.mesh,
    root.x + mean((site) => meshDeltaX(map.mesh, site.x - root.x)),
    mean((site) => site.y)
  );
  return {
    id,
    x,
    y,
    motionX: mean((site) => site.motionX),
    motionY: mean((site) => site.motionY),
    spin: 0,
  };
}
function initialBonds(map: PhysicalField, sites: TectonicSite[], seed: number) {
  const { adjacent } = provinceTerritories(sites, sites, map.mesh.periodic?.width ?? 0);
  const bonds: TectonicBond[] = [];
  for (let a = 0; a < sites.length; a++)
    for (let b = a + 1; b < sites.length; b++) {
      if (!adjacent[a * sites.length + b]) continue;
      bonds.push({
        a,
        b,
        strength: 0.6 + hashUnit(seed ^ 0x5c173, a, b) * 0.8,
        extension: 0,
        shortening: 0,
        broken: false,
        active: true,
      });
    }
  return bonds;
}
/** Origin is material history; current plate membership is a separate mechanical fact. */
export function tectonicSites(map: PhysicalField, context: PhysicalContext): TectonicSite[] {
  if (map.tectonics) return map.tectonics.sites;
  const sites = initialTectonicSites(map, context);
  const ids = [...new Set(sites.map((site) => site.plate))];
  map.tectonics = {
    sites,
    plates: ids.map((id) => plateOf(map, sites, id)),
    bonds: initialBonds(map, sites, context.EpochStableSeed),
    nextPlateId: Math.max(...ids) + 1,
    elapsedMyr: 0,
    splits: 0,
    welds: 0,
    rate: context.Profile.PlateDriftPerEpoch / tectonicReferenceMyr,
    seed: context.EpochStableSeed,
    bondLookup: new Int32Array(sites.length * sites.length).fill(-1),
    transitions: [],
  };
  indexTectonicBonds(map.tectonics);
  refreshSiteMotion(map, map.tectonics);
  return sites;
}

/** Same motion and world topology as the material scatter; never reseed moved sites. */
export function moveTectonicSites(map: PhysicalField, distance: number) {
  const state = map.tectonics;
  if (!state) return;
  const plates = new Map(state.plates.map((plate) => [plate.id, plate]));
  for (const site of state.sites) {
    const plate = plates.get(site.plate)!;
    [site.x, site.y] = meshPoint(
      map.mesh,
      ...moveTectonicPoint(map, site, plate, site.x, site.y, distance)
    );
  }
  for (const plate of state.plates) {
    const current = plateOf(map, state.sites, plate.id);
    plate.x = current.x;
    plate.y = current.y;
  }
  refreshSiteMotion(map, state);
}

export function indexTectonicBonds(state: TectonicState) {
  const n = state.sites.length;
  state.bondLookup = new Int32Array(n * n).fill(-1);
  state.bonds.forEach((bond, i) => {
    state.bondLookup[bond.a * n + bond.b] = state.bondLookup[bond.b * n + bond.a] = i;
  });
}
export function tectonicBond(state: TectonicState, a: number, b: number) {
  const index = state.bondLookup[a * state.sites.length + b];
  return index >= 0 ? state.bonds[index] : undefined;
}
