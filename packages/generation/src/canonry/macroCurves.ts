import type { LandscapeProfile } from "./landscapeProfiles";

/** Relax construction controls at a physical scale, then round their corners. */
export function roundStructuralProfile(
  profile: LandscapeProfile,
  radius: number,
  pins: number[] = []
) {
  const points = profile.points,
    distance = [0],
    fixed = new Set([0, points.length - 1, ...pins]);
  for (let n = 1; n < points.length; n++)
    distance.push(
      distance[n - 1] + Math.hypot(points[n][0] - points[n - 1][0], points[n][1] - points[n - 1][1])
    );
  let stations = points.map((point, n) => {
    if (fixed.has(n)) return { point, position: n, fixed: true };
    let x = 0,
      y = 0,
      total = 0;
    for (let j = 0; j < points.length; j++) {
      const relative = Math.abs(distance[j] - distance[n]) / radius;
      if (relative >= 1) continue;
      const weight = (1 - relative * relative) ** 2;
      x += points[j][0] * weight;
      y += points[j][1] * weight;
      total += weight;
    }
    return { point: [x / total, y / total] as [number, number], position: n, fixed: false };
  });
  for (let pass = 0; pass < 2; pass++) {
    const next = [stations[0]];
    for (let n = 1; n < stations.length; n++) {
      const a = stations[n - 1],
        b = stations[n];
      for (const t of [0.25, 0.75])
        next.push({
          point: [a.point[0] * (1 - t) + b.point[0] * t, a.point[1] * (1 - t) + b.point[1] * t],
          position: a.position * (1 - t) + b.position * t,
          fixed: false,
        });
      if (b.fixed) next.push(b);
    }
    stations = next;
  }
  const read = (values: number[], position: number, category: boolean) => {
    if (category) return values[Math.round(position)];
    const i = Math.min(values.length - 2, Math.floor(position)),
      t = position - i;
    return values[i] * (1 - t) + values[i + 1] * t;
  };
  return {
    ...profile,
    points: stations.map((s) => s.point),
    widths: stations.map((s) => read(profile.widths, s.position, false)),
    values: Object.fromEntries(
      Object.entries(profile.values).map(([name, values]) => [
        name,
        stations.map((s) => read(values, s.position, name === "landform")),
      ])
    ),
  };
}
