import type { PhysicalField } from "./field";
import { meshDeltaX, meshPoint } from "./mesh";
import { clamp } from "./math";
import { plateOf, type TectonicState, type TectonicBond, type TectonicSite } from "./tectonicState";
import { refreshSiteMotion, siteMotion } from "./tectonicMotion";
import {
  tectonicCollisionLock,
  tectonicDuctileCompliance,
  tectonicRiftFailure,
  tectonicSinkingReach,
  tectonicSutureStrength,
  tectonicWeldSpeed,
  tectonicWeldStrain,
} from "./tectonicControls";

/**
 * The closing or opening speed a shared bond feels. Sinking ocean pulls on what it is attached to, so
 * a seam or anything with ocean on it can tear; a whole continent carries the pull without tearing.
 */
function sharedLoad(bond: TectonicBond, a: TectonicSite, b: TectonicSite) {
  const pull = bond.suture || a.assembly === 0 || b.assembly === 0 ? 1 : 0;
  return [
    b.driveX - a.driveX + (b.pullX - a.pullX) * pull,
    b.driveY - a.driveY + (b.pullY - a.pullY) * pull,
  ];
}
function loadBond(map: PhysicalField, state: TectonicState, bond: TectonicBond, distance: number) {
  const a = state.sites[bond.a],
    b = state.sites[bond.b],
    dx = meshDeltaX(map.mesh, b.x - a.x),
    dy = b.y - a.y,
    length = Math.max(map.mesh.spacing, Math.hypot(dx, dy));
  const shared = a.plate === b.plate;
  if (!shared && !bond.active) return;
  const [vx, vy] = shared ? sharedLoad(bond, a, b) : [b.motionX - a.motionX, b.motionY - a.motionY];
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
/** A piece that breaks away is driven from then on by what is pulling it, which is why it broke. */
function followPull(state: TectonicState, group: number[]) {
  for (const i of group) {
    const site = state.sites[i];
    site.driveX += site.pullX;
    site.driveY += site.pullY;
  }
}
function splitPlates(map: PhysicalField, state: TectonicState, myr: number) {
  const plates = [...state.plates];
  for (const parent of plates) {
    const groups = components(state, parent.id);
    if (groups.length <= 1) continue;
    const children = [parent.id];
    for (const group of groups) followPull(state, group);
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
/** Whether a closing contact between continents has taken up all it can, or nearly stopped anyway. */
function canWeld(bond: TectonicBond, relative: number) {
  if (bond.shortening - bond.extension >= tectonicCollisionLock) return relative <= 0;
  if (bond.shortening < bond.extension + tectonicWeldStrain) return false;
  return relative <= 0 && relative >= -tectonicWeldSpeed;
}
/** The whole contact becomes one seam, weaker than what it joined and no longer driven together. */
function joinBlocks(state: TectonicState, keep: number, removed: number) {
  const members = state.sites.filter((site) => site.plate === keep || site.plate === removed);
  for (const bond of state.bonds) {
    const a = state.sites[bond.a],
      b = state.sites[bond.b];
    if (a.plate === b.plate || !members.includes(a) || !members.includes(b)) continue;
    bond.broken = false;
    bond.suture = true;
    bond.strength *= tectonicSutureStrength;
    bond.extension = 0;
    bond.shortening = 0;
  }
  return members;
}
function weld(map: PhysicalField, state: TectonicState, bond: TectonicBond, myr: number) {
  const a = state.sites[bond.a],
    b = state.sites[bond.b];
  if (!bond.active || a.plate === b.plate || a.assembly === 0 || b.assembly === 0) return;
  const dx = meshDeltaX(map.mesh, b.x - a.x),
    dy = b.y - a.y,
    length = Math.max(1, Math.hypot(dx, dy));
  const relative = ((b.motionX - a.motionX) * dx + (b.motionY - a.motionY) * dy) / length;
  if (!canWeld(bond, relative)) return;
  const keep = Math.min(a.plate, b.plate),
    removed = Math.max(a.plate, b.plate),
    members = joinBlocks(state, keep, removed);
  for (const site of members) site.plate = keep;
  state.plates = state.plates.filter((plate) => plate.id !== keep && plate.id !== removed);
  const merged = plateOf(map, state.sites, keep);
  state.plates.push(merged);
  // What drove them together ended with the collision; now they move as one.
  for (const site of members) {
    site.driveX = merged.motionX;
    site.driveY = merged.motionY;
  }
  state.welds++;
  state.transitions.push({
    kind: "weld",
    atMyr: state.elapsedMyr + myr,
    plates: [keep, removed],
    sites: members.map((site) => site.id - 1),
  });
}
/** Which of two closing provinces goes down: ocean under continent, else the plate with more to spare. */
function sinkingSite(state: TectonicState, a: TectonicSite, b: TectonicSite) {
  if (a.assembly > 0 && b.assembly > 0) return null;
  if (a.assembly > 0) return b;
  if (b.assembly > 0) return a;
  const count = (plate: number) => state.sites.filter((site) => site.plate === plate).length;
  return count(a.plate) >= count(b.plate) ? a : b;
}
/**
 * An ocean province that has run into what it sinks beneath is gone, and its plate grows new crust at
 * its far side, so oceans can close for any distance without plates passing through each other.
 */
function sinkProvinces(map: PhysicalField, state: TectonicState) {
  for (const bond of state.bonds) {
    const a = state.sites[bond.a],
      b = state.sites[bond.b];
    if (!bond.active || a.plate === b.plate) continue;
    const dx = meshDeltaX(map.mesh, b.x - a.x),
      dy = b.y - a.y,
      closing = (b.motionX - a.motionX) * dx + (b.motionY - a.motionY) * dy < 0,
      sinking = closing ? sinkingSite(state, a, b) : null;
    if (!sinking || Math.hypot(dx, dy) > Math.sqrt(sinking.area) * tectonicSinkingReach) continue;
    if (state.sites.filter((site) => site.plate === sinking.plate).length < 2) continue;
    const plate = plateOf(map, state.sites, sinking.plate);
    [sinking.x, sinking.y] = meshPoint(
      map.mesh,
      plate.x - meshDeltaX(map.mesh, sinking.x - plate.x),
      plate.y - (sinking.y - plate.y)
    );
    state.sunk++;
  }
}
/** Failure must disconnect the mechanical graph; a damaged edge alone is not a new plate. */
export function deformTectonicBonds(map: PhysicalField, state: TectonicState, myr: number) {
  for (const site of state.sites) site.compliance = 0;
  for (const bond of state.bonds) loadBond(map, state, bond, state.rate * myr);
  splitPlates(map, state, myr);
  refreshSiteMotion(map, state);
  for (const bond of state.bonds) weld(map, state, bond, myr);
  sinkProvinces(map, state);
  refreshSiteMotion(map, state);
}
