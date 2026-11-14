use super::Point;
pub struct Station {
    pub point: Point,
    pub segment: usize,
    pub fraction: f64,
}
pub fn mix(a: Point, b: Point, t: f64) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
fn flatness([a, b, c, d]: [Point; 4]) -> f64 {
    let [dx, dy] = [d[0] - a[0], d[1] - a[1]];
    let length = dx.hypot(dy);
    if length <= 0.0 {
        return 0.0;
    }
    (dx * (b[1] - a[1]) - dy * (b[0] - a[0]))
        .abs()
        .max((dx * (c[1] - a[1]) - dy * (c[0] - a[0])).abs())
        / length
}
pub fn append(points: [Point; 4], segment: usize, tolerance: f64, stations: &mut Vec<Station>) {
    let mut pending = vec![(points, 0.0, 1.0)];
    while let Some((points @ [a, b, c, d], start, end)) = pending.pop() {
        if flatness(points) <= tolerance {
            stations.push(Station {
                point: d,
                segment,
                fraction: end,
            });
            continue;
        }
        let (ab, bc, cd) = (mix(a, b, 0.5), mix(b, c, 0.5), mix(c, d, 0.5));
        let (abc, bcd) = (mix(ab, bc, 0.5), mix(bc, cd, 0.5));
        let center = mix(abc, bcd, 0.5);
        let middle = (start + end) / 2.0;
        pending.push(([center, bcd, cd, d], middle, end));
        pending.push(([a, ab, abc, center], start, middle));
    }
}
