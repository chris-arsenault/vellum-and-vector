import type { MapSpace, Position, SampleWindow } from "./generated";

/** Resolve a shared edge using published sample geography, without a generation lattice. */
export function ownsSamplePoint(window: SampleWindow, space: MapSpace, position: Position) {
  const [west, south, east, north] = window.bounds;
  let x = position[0];
  if (space.periodicWidth && (x < west || x > east))
    x += Math.round(((west + east) / 2 - x) / space.periodicWidth) * space.periodicWidth;
  const snap = (value: number) => Math.round(value / space.precision);
  const px = snap(x),
    py = snap(position[1]);
  return (
    withinInterval(px, snap(west), snap(east), window.closedEast) &&
    withinInterval(py, snap(south), snap(north), window.closedNorth)
  );
}
const withinInterval = (value: number, low: number, high: number, closed: boolean) =>
  value >= low && (closed ? value <= high : value < high);

export function validateSampleWindow(window: SampleWindow) {
  const [west, south, east, north] = window.bounds;
  if (
    !window.bounds.every(Number.isFinite) ||
    east <= west ||
    north <= south ||
    typeof window.closedEast !== "boolean" ||
    typeof window.closedNorth !== "boolean"
  )
    throw new Error("Map samples need finite positive ownership bounds and explicit outer edges.");
}
