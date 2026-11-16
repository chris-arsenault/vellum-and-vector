//! Plane geometry in map metres for a settlement plan: lines, offsets and turned rectangles.
pub type Point = [f64; 2];

pub fn add(a: Point, b: Point) -> Point {
    [a[0] + b[0], a[1] + b[1]]
}
pub fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}
pub fn scale(a: Point, by: f64) -> Point {
    [a[0] * by, a[1] * by]
}
pub fn length(a: Point) -> f64 {
    a[0].hypot(a[1])
}
pub fn distance(a: Point, b: Point) -> f64 {
    length(sub(a, b))
}
pub fn unit(a: Point) -> Point {
    let l = length(a);
    if l > 0.0 {
        scale(a, 1.0 / l)
    } else {
        [1.0, 0.0]
    }
}
/// The left-hand normal of a direction.
pub fn left(a: Point) -> Point {
    [-a[1], a[0]]
}
pub fn heading(angle: f64) -> Point {
    let (s, c) = angle.sin_cos();
    [c, s]
}
pub fn angle(a: Point) -> f64 {
    a[1].atan2(a[0])
}
pub fn line_length(points: &[Point]) -> f64 {
    points.windows(2).map(|p| distance(p[0], p[1])).sum()
}
/// The position and unit direction at `along` metres from the line's start.
pub fn at(points: &[Point], along: f64) -> Option<(Point, Point)> {
    let mut left = along.max(0.0);
    for pair in points.windows(2) {
        let step = distance(pair[0], pair[1]);
        if step > 0.0 && left <= step {
            let direction = unit(sub(pair[1], pair[0]));
            return Some((add(pair[0], scale(direction, left)), direction));
        }
        left -= step;
    }
    let (&last, before) = (points.last()?, points.get(points.len().checked_sub(2)?)?);
    Some((last, unit(sub(last, *before))))
}
/// The line redrawn with vertices no more than `step` metres apart, keeping its corners.
pub fn resample(points: &[Point], step: f64) -> Vec<Point> {
    let mut result = points.first().copied().into_iter().collect::<Vec<_>>();
    for pair in points.windows(2) {
        let pieces = (distance(pair[0], pair[1]) / step).ceil().max(1.0) as usize;
        for piece in 1..=pieces {
            let t = piece as f64 / pieces as f64;
            result.push(add(pair[0], scale(sub(pair[1], pair[0]), t)));
        }
    }
    result.dedup_by(|a, b| distance(*a, *b) < 1e-9);
    result
}
/// The first `along` metres of a line.
pub fn cut(points: &[Point], along: f64) -> Vec<Point> {
    let mut result = Vec::new();
    let mut walked = 0.0;
    for pair in points.windows(2) {
        if result.is_empty() {
            result.push(pair[0]);
        }
        let step = distance(pair[0], pair[1]);
        if walked + step >= along {
            let t = if step > 0.0 {
                (along - walked) / step
            } else {
                0.0
            };
            result.push(add(pair[0], scale(sub(pair[1], pair[0]), t)));
            return result;
        }
        walked += step;
        result.push(pair[1]);
    }
    result
}
/// The line beyond its first `along` metres.
pub fn rest(points: &[Point], along: f64) -> Vec<Point> {
    let Some((start, _)) = at(points, along) else {
        return Vec::new();
    };
    let mut walked = 0.0;
    let mut result = vec![start];
    for pair in points.windows(2) {
        walked += distance(pair[0], pair[1]);
        if walked > along {
            result.push(pair[1]);
        }
    }
    result.dedup_by(|a, b| distance(*a, *b) < 1e-9);
    result
}
/// A line drawn `by` metres to the left of another (negative: to the right).
pub fn offset(points: &[Point], by: f64) -> Vec<Point> {
    (0..points.len())
        .map(|i| {
            let before = points[i.saturating_sub(1)];
            let after = points[(i + 1).min(points.len() - 1)];
            add(points[i], scale(left(unit(sub(after, before))), by))
        })
        .collect()
}
/// A rectangle whose front edge is centred on `front`, `width` along `direction` and `depth`
/// deep towards `inward`; corners run counter-clockwise and close.
pub fn rectangle(
    front: Point,
    direction: Point,
    inward: Point,
    width: f64,
    depth: f64,
) -> Vec<Point> {
    let half = scale(direction, width / 2.0);
    let back = scale(inward, depth);
    let a = sub(front, half);
    let b = add(front, half);
    let mut ring = vec![a, b, add(b, back), add(a, back), a];
    let clockwise = ring
        .windows(2)
        .map(|p| p[0][0] * p[1][1] - p[1][0] * p[0][1])
        .sum::<f64>()
        < 0.0;
    if clockwise {
        ring.reverse();
    }
    ring
}
/// A closed ring of `count` points at `radius` around `centre`, each pushed by `wobble(i)`.
pub fn ring(centre: Point, radius: f64, count: usize, wobble: impl Fn(usize) -> f64) -> Vec<Point> {
    let mut points = (0..count)
        .map(|i| {
            let turn = i as f64 / count as f64 * std::f64::consts::TAU;
            add(centre, scale(heading(turn), radius * (1.0 + wobble(i))))
        })
        .collect::<Vec<_>>();
    points.push(points[0]);
    points
}
/// Where segment a→b first meets segment c→d, as the fraction along a→b.
pub fn crossing(a: Point, b: Point, c: Point, d: Point) -> Option<f64> {
    let r = sub(b, a);
    let s = sub(d, c);
    let denominator = r[0] * s[1] - r[1] * s[0];
    if denominator.abs() < 1e-12 {
        return None;
    }
    let q = sub(c, a);
    let t = (q[0] * s[1] - q[1] * s[0]) / denominator;
    let u = (q[0] * r[1] - q[1] * r[0]) / denominator;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u)).then_some(t)
}
/// A small repeatable sequence of fractions for layout choices, keyed by the settlement.
pub struct Jitter(u64);
impl Jitter {
    pub fn new(key: &str) -> Self {
        Self(key.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)
        }))
    }
    /// The next fraction, from zero to one.
    pub fn sample(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        (z ^ (z >> 31)) as f64 / u64::MAX as f64
    }
    /// A value spread evenly within `centre ± spread`.
    pub fn around(&mut self, centre: f64, spread: f64) -> f64 {
        centre + (self.sample() * 2.0 - 1.0) * spread
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn walking_cutting_and_resampling_a_line_keep_its_course() {
        let line = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]];
        assert_eq!(line_length(&line), 20.0);
        let (p, d) = at(&line, 15.0).unwrap();
        assert!((p[0] - 10.0).abs() < 1e-9 && (p[1] - 5.0).abs() < 1e-9);
        assert!((d[1] - 1.0).abs() < 1e-9);
        let first = cut(&line, 12.0);
        assert!((line_length(&first) - 12.0).abs() < 1e-9);
        let beyond = rest(&line, 12.0);
        assert!((line_length(&beyond) - 8.0).abs() < 1e-9);
        assert_eq!(beyond.first(), first.last());
        let fine = resample(&line, 3.0);
        assert!(fine.windows(2).all(|p| distance(p[0], p[1]) <= 3.0 + 1e-9));
        assert!(fine.contains(&[10.0, 0.0]));
        assert!((line_length(&fine) - 20.0).abs() < 1e-9);
    }
    #[test]
    fn offsets_rectangles_and_crossings_are_placed_where_stated() {
        let shifted = offset(&[[0.0, 0.0], [10.0, 0.0]], 2.0);
        assert_eq!(shifted, vec![[0.0, 2.0], [10.0, 2.0]]);
        let plot = rectangle([0.0, 0.0], [1.0, 0.0], [0.0, -1.0], 6.0, 20.0);
        assert_eq!(plot.len(), 5);
        assert_eq!(plot.first(), plot.last());
        assert!(plot
            .iter()
            .all(|p| p[0].abs() <= 3.0 && (-20.0..=0.0).contains(&p[1])));
        let area = plot
            .windows(2)
            .map(|p| p[0][0] * p[1][1] - p[1][0] * p[0][1])
            .sum::<f64>()
            / 2.0;
        assert!((area - 120.0).abs() < 1e-9);
        let t = crossing([0.0, 0.0], [10.0, 0.0], [4.0, -1.0], [4.0, 1.0]).unwrap();
        assert!((t - 0.4).abs() < 1e-9);
        assert!(crossing([0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]).is_none());
    }
    #[test]
    fn jitter_repeats_for_one_key_and_stays_in_range() {
        let mut a = Jitter::new("town");
        let mut b = Jitter::new("town");
        for _ in 0..100 {
            let value = a.sample();
            assert_eq!(value, b.sample());
            assert!((0.0..=1.0).contains(&value));
        }
    }
}
