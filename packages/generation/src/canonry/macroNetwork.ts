type Point = [number, number];
type Segment = { a: Point; b: Point; owner: number };
const side = (a: Point, b: Point, p: Point) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function crosses(a: Segment, b: Segment) {
  return (
    side(a.a, a.b, b.a) * side(a.a, a.b, b.b) < -1e-6 &&
    side(b.a, b.b, a.a) * side(b.a, b.b, a.b) < -1e-6
  );
}

/** Find accidental proper crossings, excluding the graph's shared endpoints. */
export function crossingReaches(curves: { points: Point[] }[], size: number) {
  const bins = new Map<string, Segment[]>(),
    bad = new Set<number>();
  curves.forEach(({ points }, owner) => {
    for (let n = 1; n < points.length; n++) {
      const segment = { a: points[n - 1], b: points[n], owner },
        seen = new Set<Segment>();
      for (
        let x = Math.floor(Math.min(segment.a[0], segment.b[0]) / size);
        x <= Math.floor(Math.max(segment.a[0], segment.b[0]) / size);
        x++
      )
        for (
          let y = Math.floor(Math.min(segment.a[1], segment.b[1]) / size);
          y <= Math.floor(Math.max(segment.a[1], segment.b[1]) / size);
          y++
        ) {
          const key = `${x}:${y}`,
            nearby = bins.get(key) ?? [];
          for (const other of nearby) {
            if (!seen.has(other) && crosses(segment, other)) {
              bad.add(owner);
              bad.add(other.owner);
            }
            seen.add(other);
          }
          nearby.push(segment);
          bins.set(key, nearby);
        }
    }
  });
  return bad;
}
