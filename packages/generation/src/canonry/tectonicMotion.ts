import type { PhysicalField } from "./field";
import type { TectonicPlate, TectonicSite, TectonicState } from "./tectonicState";
import { meshDeltaX } from "./mesh";
import {
  tectonicContactMyr,
  tectonicRelaxationMyr,
  tectonicRotationGain,
} from "./tectonicControls";

export function siteMotion(
  map: PhysicalField,
  site: Pick<TectonicSite, "x" | "y">,
  plate: TectonicPlate
) {
  const dx = meshDeltaX(map.mesh, site.x - plate.x),
    dy = site.y - plate.y;
  return [plate.motionX - plate.spin * dy, plate.motionY + plate.spin * dx];
}
/** Finite rigid rotation plus the same ductile residual used by the mechanical sites. */
export function moveTectonicPoint(
  map: PhysicalField,
  site: TectonicSite,
  plate: TectonicPlate,
  x: number,
  y: number,
  distance: number
): [number, number] {
  const dx = meshDeltaX(map.mesh, x - plate.x),
    dy = y - plate.y,
    angle = plate.spin * distance,
    [vx, vy] = siteMotion(map, { x, y }, plate);
  return [
    x +
      plate.motionX * distance +
      dx * (Math.cos(angle) - 1) -
      dy * Math.sin(angle) +
      site.compliance * (site.driveX - vx) * distance,
    y +
      plate.motionY * distance +
      dx * Math.sin(angle) +
      dy * (Math.cos(angle) - 1) +
      site.compliance * (site.driveY - vy) * distance,
  ];
}
export function refreshSiteMotion(map: PhysicalField, state: TectonicState) {
  const plates = new Map(state.plates.map((plate) => [plate.id, plate]));
  for (const site of state.sites) {
    const [x, y] = siteMotion(map, site, plates.get(site.plate)!);
    site.motionX = x + site.compliance * (site.driveX - x);
    site.motionY = y + site.compliance * (site.driveY - y);
  }
}
function driving(map: PhysicalField, members: TectonicSite[], plate: TectonicPlate) {
  let x = 0,
    y = 0,
    torque = 0,
    radius = 0;
  const mass = members.reduce((sum, site) => sum + site.mass, 0);
  for (const site of members) {
    x += (site.driveX * site.mass) / mass;
    y += (site.driveY * site.mass) / mass;
  }
  for (const site of members) {
    const dx = meshDeltaX(map.mesh, site.x - plate.x),
      dy = site.y - plate.y;
    torque += (dx * (site.driveY - y) - dy * (site.driveX - x)) * site.mass;
    radius += (dx * dx + dy * dy) * site.mass;
  }
  const area = members.reduce((sum, site) => sum + site.area, 0);
  const inertia = Math.max(radius, (mass * area) / (2 * Math.PI));
  return [x, y, (torque / Math.max(1, inertia)) * tectonicRotationGain];
}
function contactResistance(map: PhysicalField, state: TectonicState, myr: number) {
  const plates = new Map(state.plates.map((plate) => [plate.id, plate]));
  const masses = new Map(
    state.plates.map((plate) => [
      plate.id,
      state.sites
        .filter((site) => site.plate === plate.id)
        .reduce((sum, site) => sum + site.mass, 0),
    ])
  );
  const weight = 1 - Math.exp(-myr / tectonicContactMyr);
  for (const bond of state.bonds) {
    const a = state.sites[bond.a],
      b = state.sites[bond.b];
    if (!bond.active || a.plate === b.plate) continue;
    const dx = meshDeltaX(map.mesh, b.x - a.x),
      dy = b.y - a.y,
      length = Math.max(1, Math.hypot(dx, dy));
    const first = plates.get(a.plate)!,
      second = plates.get(b.plate)!;
    const [ax, ay] = siteMotion(map, a, first),
      [bx, by] = siteMotion(map, b, second);
    const relative = ((bx - ax) * dx + (by - ay) * dy) / length;
    if (relative >= 0) continue;
    const impulse = -relative * weight,
      firstMass = masses.get(a.plate)!,
      secondMass = masses.get(b.plate)!,
      firstShare = secondMass / (firstMass + secondMass),
      secondShare = 1 - firstShare;
    first.motionX -= (impulse * firstShare * dx) / length;
    first.motionY -= (impulse * firstShare * dy) / length;
    second.motionX += (impulse * secondShare * dx) / length;
    second.motionY += (impulse * secondShare * dy) / length;
  }
}
/** A coarse driven plate model: contacts resist closure; regional driving supplies motion. */
export function updatePlateMotion(map: PhysicalField, state: TectonicState, myr: number) {
  const weight = 1 - Math.exp(-myr / tectonicRelaxationMyr);
  for (const plate of state.plates) {
    const members = state.sites.filter((site) => site.plate === plate.id),
      [x, y, spin] = driving(map, members, plate);
    plate.motionX += (x - plate.motionX) * weight;
    plate.motionY += (y - plate.motionY) * weight;
    plate.spin += (spin - plate.spin) * weight;
  }
  contactResistance(map, state, myr);
  refreshSiteMotion(map, state);
}
