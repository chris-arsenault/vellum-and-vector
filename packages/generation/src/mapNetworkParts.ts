import {
  canonicalPosition,
  lineParts,
  spatial,
  type AtlasFeature,
  type World,
} from "@atlas/domain";

/** A named course may cross junctions. Its network keeps those interior nodes and profiles. */
export function networkParts(feature: AtlasFeature, reference: World["reference"]) {
  const key = (p: number[]) => {
    const at = canonicalPosition(reference, { x: p[0], y: p[1], z: 0 });
    return `${at.x.toFixed(6)}:${at.y.toFixed(6)}`;
  };
  const junctions = new Set(((feature.attributes.junctions ?? []) as number[][]).map(key)),
    precision = reference.precision ?? spatial.precision;
  return lineParts(feature.geometry).flatMap((coordinates) => {
    const cuts = [
      0,
      ...coordinates.flatMap((p, i) =>
        i > 0 && i < coordinates.length - 1 && junctions.has(key(p)) ? [i] : []
      ),
      coordinates.length - 1,
    ];
    return cuts.slice(1).flatMap((end, i) => {
      const start = cuts[i],
        attributes = { ...feature.attributes };
      // Two junctions closer than the map stores apart leave no stretch between them.
      if (!hasLength(coordinates.slice(start, end + 1), precision)) return [];
      for (const [name, values] of Object.entries(attributes))
        if (name !== "junctions" && Array.isArray(values) && values.length === coordinates.length)
          attributes[name] = values.slice(start, end + 1);
      if (Array.isArray(attributes.discharges)) attributes.discharge = attributes.discharges[0];
      return [{ coordinates: coordinates.slice(start, end + 1), attributes }];
    });
  });
}
/** Whether a line's points stand apart once placed on the grid the map stores positions on. */
function hasLength(coordinates: number[][], precision: number) {
  const at = (value: number) => Math.round(value / precision),
    [x, y] = coordinates[0];
  return coordinates.some((p) => at(p[0]) !== at(x) || at(p[1]) !== at(y));
}
