import { canonicalPosition, lineParts, type AtlasFeature, type World } from "@atlas/domain";

/** A named course may cross junctions. Its network keeps those interior nodes and profiles. */
export function networkParts(feature: AtlasFeature, reference: World["reference"]) {
  const key = (p: number[]) => {
    const at = canonicalPosition(reference, { x: p[0], y: p[1], z: 0 });
    return `${at.x.toFixed(6)}:${at.y.toFixed(6)}`;
  };
  const junctions = new Set(((feature.attributes.junctions ?? []) as number[][]).map(key));
  return lineParts(feature.geometry).flatMap((coordinates) => {
    const cuts = [
      0,
      ...coordinates.flatMap((p, i) =>
        i > 0 && i < coordinates.length - 1 && junctions.has(key(p)) ? [i] : []
      ),
      coordinates.length - 1,
    ];
    return cuts.slice(1).map((end, i) => {
      const start = cuts[i],
        attributes = { ...feature.attributes };
      for (const [name, values] of Object.entries(attributes))
        if (name !== "junctions" && Array.isArray(values) && values.length === coordinates.length)
          attributes[name] = values.slice(start, end + 1);
      if (Array.isArray(attributes.discharges)) attributes.discharge = attributes.discharges[0];
      return { coordinates: coordinates.slice(start, end + 1), attributes };
    });
  });
}
