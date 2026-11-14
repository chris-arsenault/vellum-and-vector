import type { Bounds, MapDescriptor, MapSpace, Position } from "./generated";

export function mapSpace(map: MapDescriptor, id: string): MapSpace {
  const space = map.spaces.find((space) => space.id === id);
  if (!space) throw new Error("Coordinate space was not found in this map.");
  return space;
}

/** A location in a cylindrical chart remains on this map and revision. */
export function mapPosition(space: MapSpace, position: Position): Position {
  if (!position.every(Number.isFinite)) throw new Error("Map positions must be finite.");
  const width = space.periodicWidth;
  if (!width) return position;
  const west = space.bounds[0];
  const x = west + ((((position[0] - west) % width) + width) % width);
  return position.length === 3 ? [x, position[1], position[2]] : [x, position[1]];
}
export function mapBounds(bounds: Bounds): Bounds {
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite) || east < west || north < south)
    throw new Error("Map query needs finite ordered bounds.");
  return bounds;
}
