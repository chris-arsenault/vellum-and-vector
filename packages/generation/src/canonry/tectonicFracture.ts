import type { PhysicalField } from "./field";
import { meshDeltaX } from "./mesh";
import { clamp } from "./math";
import { plateOf, type TectonicState, type TectonicBond } from "./tectonicState";
import { refreshSiteMotion, siteMotion } from "./tectonicMotion";
import {
  tectonicRiftFailure,
  tectonicDuctileCompliance,
  tectonicWeldStrain,
  tectonicWeldSpeed,
} from "./tectonicControls";

function loadBond(map: PhysicalField, state: TectonicState, bond: TectonicBond, distance: number) {
  const a = state.sites[bond.a],
    b = state.sites[bond.b],
    dx = meshDeltaX(map.mesh, b.x - a.x),
    dy = b.y - a.y,
    length = Math.max(map.mesh.spacing, Math.hypot(dx, dy));
  const shared = a.plate === b.plate;
  if (!shared && !bond.active) return;
  const vx = shared ? b.driveX - a.driveX : b.motionX - a.motionX,
    vy = shared ? b.driveY - a.driveY : b.motionY - a.motionY;
  const relative = (vx * dx + vy * dy) / length;
  bond.extension += (Math.max(0, relative) * distance) / (length * bond.strength);
  bond.shortening += (Math.max(0, -relative) * distance) / length;
  healCompression(bond, shared, relative);
  const damage = Math.max(0, bond.extension - bond.shortening);
  if (shared && damage >= tectonicRiftFailure) bond.broken = true;
  if (!shared) return;
  const compliance = clamp(damage / tectonicRiftFailure, 0, 1) * tectonicDuctileCompliance;
  a.compliance = Math.max(a.compliance, compliance);
  b.compliance = Math.max(b.compliance, compliance);
}
function healCompression(bond: TectonicBond, shared: boolean, relative: number) {
  if (shared && relative < 0 && bond.shortening > bond.extension + tectonicWeldStrain)
    bond.broken = false;
}
function components(state: TectonicState, id: number) {
  const members = state.sites.map((site, i) => (site.plate === id ? i : -1)).filter((i) => i >= 0),
    remaining = new Set(members),
    result: number[][] = [];
  const edges = state.bonds.filter(
    (bond) => !bond.broken && remaining.has(bond.a) && remaining.has(bond.b)
  );
  for (const first of members) {
    if (!remaining.delete(first)) continue;
    const group = [first];
    for (let head = 0; head < group.length; head++)
      for (const bond of edges) {
        const next = bond.a === group[head] ? bond.b : bond.b === group[head] ? bond.a : -1;
        if (next >= 0 && remaining.delete(next)) group.push(next);
      }
    result.push(group);
  }
  // hpc-exempt: province groups of one plate, a handful of arrays.
  return result.sort((a, b) => b.length - a.length || a[0] - b[0]);
}
function splitPlates(map: PhysicalField, state: TectonicState, myr: number) {
  const plates = [...state.plates];
  for (const parent of plates) {
    const groups = components(state, parent.id);
    if (groups.length <= 1) continue;
    const children = [parent.id];
    for (const group of groups.slice(1)) {
      const id = state.nextPlateId++;
      for (const i of group) state.sites[i].plate = id;
      const daughter = plateOf(map, state.sites, id);
      const sample = { ...state.sites[group[0]], x: daughter.x, y: daughter.y };
      [daughter.motionX, daughter.motionY] = siteMotion(map, sample, parent);
      daughter.spin = parent.spin;
      state.plates.push(daughter);
      children.push(id);
    }
    const center = plateOf(map, state.sites, parent.id);
    const sample = { ...state.sites[groups[0][0]], x: center.x, y: center.y };
    [parent.motionX, parent.motionY] = siteMotion(map, sample, parent);
    parent.x = center.x;
    parent.y = center.y;
    state.splits += groups.length - 1;
    state.transitions.push({
      kind: "split",
      atMyr: state.elapsedMyr + myr,
      plates: children,
      sites: groups.flat(),
    });
  }
}
function weld(map: PhysicalField, state: TectonicState, bond: TectonicBond, myr: number) {
  const a = state.sites[bond.a],
    b = state.sites[bond.b];
  if (!bond.active || a.plate === b.plate || a.assembly === 0 || b.assembly === 0) return;
  if (bond.shortening < bond.extension + tectonicWeldStrain) return;
  const dx = meshDeltaX(map.mesh, b.x - a.x),
    dy = b.y - a.y,
    length = Math.max(1, Math.hypot(dx, dy));
  const relative = ((b.motionX - a.motionX) * dx + (b.motionY - a.motionY) * dy) / length;
  if (relative > 0 || relative < -tectonicWeldSpeed) return;
  const keep = Math.min(a.plate, b.plate),
    removed = Math.max(a.plate, b.plate);
  const members = state.sites.filter((site) => site.plate === keep || site.plate === removed);
  for (const site of members) site.plate = keep;
  state.plates = state.plates.filter((plate) => plate.id !== keep && plate.id !== removed);
  state.plates.push(plateOf(map, state.sites, keep));
  bond.broken = false;
  state.welds++;
  state.transitions.push({
    kind: "weld",
    atMyr: state.elapsedMyr + myr,
    plates: [keep, removed],
    sites: members.map((site) => site.id - 1),
  });
}
/** Failure must disconnect the mechanical graph; a damaged edge alone is not a new plate. */
export function deformTectonicBonds(map: PhysicalField, state: TectonicState, myr: number) {
  for (const site of state.sites) site.compliance = 0;
  for (const bond of state.bonds) loadBond(map, state, bond, state.rate * myr);
  splitPlates(map, state, myr);
  refreshSiteMotion(map, state);
  for (const bond of state.bonds) weld(map, state, bond, myr);
  refreshSiteMotion(map, state);
}
