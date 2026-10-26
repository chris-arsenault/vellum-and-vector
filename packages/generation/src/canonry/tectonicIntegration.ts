import type { PhysicalField } from "./field";
import { meshDeltaX, meshPoint } from "./mesh";
import { moveTectonicSites, type TectonicPlate } from "./tectonicState";
import { updatePlateMotion } from "./tectonicMotion";
import { tectonicStepMyr, tectonicStepTravel } from "./tectonicControls";
import { refreshTectonicContacts } from "./tectonicContacts";
import { deformTectonicBonds } from "./tectonicFracture";

export function tectonicInterval(map: PhysicalField, remaining: number, rate: number) {
  const speed = map.tectonics!.sites.reduce(
    (maximum, site) => Math.max(maximum, Math.hypot(site.motionX, site.motionY)),
    0.001
  );
  return Math.min(remaining, tectonicStepMyr, tectonicStepTravel / (speed * rate));
}
export function prepareTectonicMotion(map: PhysicalField, myr: number) {
  refreshTectonicContacts(map, map.tectonics!);
  deformTectonicBonds(map, map.tectonics!, myr);
  updatePlateMotion(map, map.tectonics!, myr);
}
export function completeTectonicMotion(map: PhysicalField, myr: number, distance: number) {
  moveTectonicSites(map, distance);
  map.tectonics!.elapsedMyr += myr;
}

interface MotionFrame {
  plates: TectonicPlate[];
  sites: {
    x: number;
    y: number;
    plate: number;
    compliance: number;
    driveX: number;
    driveY: number;
  }[];
  distance: number;
}
function inversePoint(map: PhysicalField, [x, y]: [number, number], frame: MotionFrame) {
  let nearest = frame.sites[0],
    minimum = Infinity;
  for (const site of frame.sites) {
    const distance = meshDeltaX(map.mesh, site.x - x) ** 2 + (site.y - y) ** 2;
    if (distance < minimum) {
      minimum = distance;
      nearest = site;
    }
  }
  const plate = frame.plates.find((plate) => plate.id === nearest.plate)!,
    angle = plate.spin * frame.distance,
    share = nearest.compliance,
    vx = plate.motionX * (1 - share) + nearest.driveX * share,
    vy = plate.motionY * (1 - share) + nearest.driveY * share,
    dx = meshDeltaX(map.mesh, x - plate.x - vx * frame.distance),
    dy = y - plate.y - vy * frame.distance,
    a = Math.cos(angle),
    b = Math.sin(angle) - share * angle,
    determinant = a * a + b * b;
  return meshPoint(
    map.mesh,
    plate.x + (a * dx + b * dy) / determinant,
    plate.y + (-b * dx + a * dy) / determinant
  );
}
/** Forecast only the coarse mechanical state, not terrain, magic or ecology. */
export function backtrackTectonicPoint(
  map: PhysicalField,
  point: [number, number],
  distances: number[]
): [number, number] {
  const forecast = { ...map, tectonics: structuredClone(map.tectonics!) },
    frames: MotionFrame[] = [],
    rate = forecast.tectonics.rate;
  for (const distance of distances) {
    let remaining = distance / rate;
    while (remaining > 1e-9) {
      const myr = tectonicInterval(forecast, remaining, rate),
        step = myr * rate;
      prepareTectonicMotion(forecast, myr);
      const plates = structuredClone(forecast.tectonics.plates);
      completeTectonicMotion(forecast, myr, step);
      frames.push({ plates, sites: structuredClone(forecast.tectonics.sites), distance: step });
      remaining -= myr;
    }
  }
  for (const frame of frames.reverse()) point = inversePoint(map, point, frame);
  return point;
}
