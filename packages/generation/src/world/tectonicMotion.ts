import type { PhysicalField } from "./field";
import type { TectonicPlate, TectonicSite, TectonicState } from "./tectonicState";
import { meshDeltaX } from "./mesh";
import {
  tectonicContactMyr,
  tectonicEdgeReach,
  tectonicRelaxationMyr,
  tectonicRotationGain,
  tectonicSlabPull,
  tectonicSubductionResistance,
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
    // Continents too buoyant to sink push back; an ocean between plates goes down and lets them close.
    const buoyant = a.assembly > 0 && b.assembly > 0,
      impulse = -relative * weight * (buoyant ? 1 : tectonicSubductionResistance),
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
/**
 * What a plate's outward motion keeps as its continent nears the edge of a bounded map: all of it
 * while the continent is further than `reach` away, and none once it is there.
 */
export const edgeAllowance = (gap: number, reach: number) => Math.max(0, Math.min(1, gap / reach));
/**
 * A bounded map's edge is the end of the world's crust: an ocean can pass under it, but a continent
 * cannot leave. A plate slows against the edge as the continent it carries comes up to it, which
 * also turns the rest of its motion into shortening against whatever it meets.
 */
function edgeResistance(map: PhysicalField, members: TectonicSite[], plate: TectonicPlate) {
  const continent = members.filter((site) => site.assembly > 0);
  if (!continent.length) return;
  const [west, south, east, north] = map.mesh.bounds,
    [originX, originY] = map.mesh.origin,
    xs = continent.map((site) => site.x),
    ys = continent.map((site) => site.y);
  if (!map.mesh.periodic) {
    if (plate.motionX > 0)
      plate.motionX *= edgeAllowance(east - originX - Math.max(...xs), tectonicEdgeReach);
    else plate.motionX *= edgeAllowance(Math.min(...xs) - (west - originX), tectonicEdgeReach);
  }
  if (plate.motionY > 0)
    plate.motionY *= edgeAllowance(north - originY - Math.max(...ys), tectonicEdgeReach);
  else plate.motionY *= edgeAllowance(Math.min(...ys) - (south - originY), tectonicEdgeReach);
}
function addContact(
  pulls: { x: number; y: number; contacts: number }[],
  sinking: boolean,
  dx: number,
  dy: number,
  length: number
) {
  for (const pull of pulls) {
    pull.contacts++;
    if (!sinking) continue;
    pull.x += dx / length;
    pull.y += dy / length;
  }
}
/**
 * Ocean crust sinking at a closing contact pulls the rest of its plate after it, which is most of what
 * moves real plates. Each plate is pulled towards its sinking edges by the share of its contacts that
 * are sinking; a continent makes a plate slower to drag, and where no ocean is left the pull ends.
 */
function slabPull(map: PhysicalField, state: TectonicState) {
  const pulls = new Map(state.plates.map((plate) => [plate.id, { x: 0, y: 0, contacts: 0 }])),
    blocks = new Map<number, { x: number; y: number; contacts: number }>(),
    own = state.sites.map(() => ({ x: 0, y: 0, contacts: 0 }));
  const blockOf = (id: number) => {
    if (!blocks.has(id)) blocks.set(id, { x: 0, y: 0, contacts: 0 });
    return blocks.get(id)!;
  };
  for (const bond of state.bonds) {
    const a = state.sites[bond.a],
      b = state.sites[bond.b];
    if (!bond.active || a.plate === b.plate) continue;
    const dx = meshDeltaX(map.mesh, b.x - a.x),
      dy = b.y - a.y,
      length = Math.max(1, Math.hypot(dx, dy)),
      closing = (a.motionX - b.motionX) * dx + (a.motionY - b.motionY) * dy > 0;
    addContact(
      [pulls.get(a.plate)!, blockOf(a.block), own[bond.a]],
      closing && a.assembly === 0,
      dx,
      dy,
      length
    );
    addContact(
      [pulls.get(b.plate)!, blockOf(b.block), own[bond.b]],
      closing && b.assembly === 0,
      -dx,
      -dy,
      length
    );
  }
  state.sites.forEach((site, i) => {
    // Ocean feels its own edges; a continent is too strong to, and feels its whole block's.
    const pull = site.assembly === 0 ? own[i] : blocks.get(site.block);
    site.pullX = pull ? pull.x / Math.max(1, pull.contacts) : 0;
    site.pullY = pull ? pull.y / Math.max(1, pull.contacts) : 0;
  });
  return pulls;
}
/** Each province's mass over its area: how much of a plate is continent to drag along. */
function drag(members: TectonicSite[]) {
  const mass = members.reduce((sum, site) => sum + site.mass, 0),
    area = members.reduce((sum, site) => sum + site.area, 0);
  return area > 0 ? mass / area : 1;
}
/** A driven plate model: slabs pull, contacts between continents resist, regions drive the rest. */
export function updatePlateMotion(map: PhysicalField, state: TectonicState, myr: number) {
  const weight = 1 - Math.exp(-myr / tectonicRelaxationMyr),
    pulls = slabPull(map, state);
  for (const plate of state.plates) {
    const members = state.sites.filter((site) => site.plate === plate.id),
      [x, y, spin] = driving(map, members, plate),
      pull = pulls.get(plate.id)!,
      strength = tectonicSlabPull / (Math.max(1, pull.contacts) * drag(members));
    plate.motionX += (x + pull.x * strength - plate.motionX) * weight;
    plate.motionY += (y + pull.y * strength - plate.motionY) * weight;
    plate.spin += (spin - plate.spin) * weight;
  }
  contactResistance(map, state, myr);
  for (const plate of state.plates)
    edgeResistance(
      map,
      state.sites.filter((site) => site.plate === plate.id),
      plate
    );
  refreshSiteMotion(map, state);
}
