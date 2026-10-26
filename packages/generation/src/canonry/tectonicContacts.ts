import type { PhysicalField } from "./field";
import { provinceTerritories } from "./provinceTerritories";
import { hashUnit } from "./noise";
import { indexTectonicBonds, type TectonicState } from "./tectonicState";

/** Keep structural history, but apply contact forces only where current territories meet. */
export function refreshTectonicContacts(map: PhysicalField, state: TectonicState) {
  const n = state.sites.length,
    { adjacent } = provinceTerritories(state.sites, state.sites, map.mesh.periodic?.width ?? 0);
  indexTectonicBonds(state);
  for (const bond of state.bonds) bond.active = false;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      if (!adjacent[a * n + b]) continue;
      const index = state.bondLookup[a * n + b];
      if (index >= 0) state.bonds[index].active = true;
      else
        state.bonds.push({
          a,
          b,
          strength: 0.6 + hashUnit(state.seed ^ 0x5c173, a, b) * 0.8,
          extension: 0,
          shortening: 0,
          broken: true,
          active: true,
        });
    }
  indexTectonicBonds(state);
}
