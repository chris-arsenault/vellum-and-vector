//! Fields beyond the built edge. Seeds are scattered over the country about a block apart and
//! each block is the land nearer its seed than any other, drawn in from its neighbours by a
//! balk, cut back from the ways that cross it and kept only on open ground. Arable blocks near
//! a place are ploughed in strips running back from their nearest way; pasture and blocks
//! further out stay single enclosures. Field size, shape and grain so follow the ways and the
//! distance from the people who work them, not one grid laid over the map.
use super::{
    geometry::{distance, dot, left, sub, unit, Jitter, Point},
    ground::{Convex, Ground, FIELD},
};

/// A field and what it grows.
pub struct Field {
    pub corners: Vec<Point>,
    pub pasture: bool,
}
/// The country around the built places.
pub struct Country<'a> {
    /// Each place's centre and how far from it the place is built.
    pub places: &'a [(Point, f64)],
    /// Streets and roads, whose lines fields keep clear of and turn their strips to.
    pub ways: &'a [Vec<Point>],
    pub bounds: [f64; 4],
    /// Mean side of a block in metres.
    pub block: f64,
    /// Mean width of a ploughed strip in metres.
    pub strip: f64,
    pub key: &'a str,
}
use super::settings::{BALK, FIELD_VERGE as VERGE, MERGED, STRIP_REACH};

/// Fields outward from the built edges until `target` square metres are farmed; `share`
/// gives the farmland and pasture shares at a point.
pub fn fields(
    country: &Country<'_>,
    ground: &mut Ground,
    target: f64,
    share: impl Fn(Point) -> (f64, f64),
) -> Vec<Field> {
    let mut jitter = Jitter::new(&format!("{}:fields", country.key));
    let seeds = Seeds::scatter(country, &mut jitter);
    // With no place on the map its fields are worked from farmsteads beyond it: each block
    // is worked as often as the land's farmed share says, in no order outward from anywhere.
    let lone = country.places.is_empty();
    let mut farmed = 0.0;
    let mut result = Vec::new();
    for (near, at) in seeds.outward(country, &mut jitter) {
        if farmed >= target {
            break;
        }
        let Some(block) = seeds.block(at, country).and_then(|b| fit(b, ground)) else {
            continue;
        };
        let middle = centroid(&block);
        let (farm, pasture) = share(middle);
        let worked = farm + pasture;
        if worked <= 0.0 || (lone && jitter.sample() >= worked.min(1.0)) {
            continue;
        }
        ground.take(&Convex(&block), FIELD);
        farmed += area(&block);
        let grazed = pasture > farm;
        if grazed || near > STRIP_REACH * country.block {
            result.push(Field {
                corners: block,
                pasture: grazed,
            });
            continue;
        }
        let along = nearest_way(middle, country.ways).unwrap_or_else(|| {
            let from = country.places.first().map_or(middle, |p| p.0);
            left(unit(sub(middle, from)))
        });
        result.extend(
            strips(&block, along, country.strip, &mut jitter)
                .into_iter()
                .map(|corners| Field {
                    corners,
                    pasture: false,
                }),
        );
    }
    result
}
/// Seeds a block apart in staggered rows, each moved within its block, some left out.
struct Seeds {
    points: Vec<Point>,
    columns: usize,
    rows: usize,
    origin: Point,
    cell: f64,
    /// Seed indexes in each bucket of `cell` metres.
    buckets: Vec<Vec<usize>>,
}
impl Seeds {
    fn scatter(country: &Country<'_>, jitter: &mut Jitter) -> Self {
        let [w, s, e, n] = country.bounds;
        let cell = country.block;
        let columns = ((e - w) / cell).ceil() as usize + 1;
        let rows = ((n - s) / cell).ceil() as usize + 1;
        let mut seeds = Self {
            points: Vec::new(),
            columns,
            rows,
            origin: [w, s],
            cell,
            buckets: vec![Vec::new(); columns * rows],
        };
        for row in 0..rows {
            let stagger = if row % 2 == 0 { 0.0 } else { 0.5 };
            for column in 0..columns {
                let x = w + (column as f64 + stagger + jitter.around(0.0, 0.4)) * cell;
                let y = s + (row as f64 + jitter.around(0.0, 0.4)) * cell;
                if jitter.sample() < MERGED || x > e || y > n || x < w || y < s {
                    continue;
                }
                if let Some(bucket) = seeds.bucket([x, y]) {
                    seeds.buckets[bucket].push(seeds.points.len());
                    seeds.points.push([x, y]);
                }
            }
        }
        seeds
    }
    fn bucket(&self, p: Point) -> Option<usize> {
        let x = ((p[0] - self.origin[0]) / self.cell).floor();
        let y = ((p[1] - self.origin[1]) / self.cell).floor();
        (x >= 0.0 && y >= 0.0 && (x as usize) < self.columns && (y as usize) < self.rows)
            .then(|| y as usize * self.columns + x as usize)
    }
    /// Seeds beyond every built edge, with their distance past the nearest, nearest first; with
    /// no place, every seed at an infinite distance in a scattered order.
    fn outward(&self, country: &Country<'_>, jitter: &mut Jitter) -> Vec<(f64, usize)> {
        let mut order = self
            .points
            .iter()
            .enumerate()
            .map(|(i, &p)| {
                let near = country
                    .places
                    .iter()
                    .map(|&(c, built)| distance(c, p) - built)
                    .fold(f64::INFINITY, f64::min);
                (near, jitter.sample(), i)
            })
            .filter(|&(near, _, _)| near > country.block / 2.0)
            .collect::<Vec<_>>();
        // hpc-exempt: orders field seeds outward from the built edge, scattered when no place.
        order.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        order.into_iter().map(|(near, _, i)| (near, i)).collect()
    }
    /// The land nearer seed `i` than any neighbour, drawn in by a balk, cut back from ways.
    fn block(&self, i: usize, country: &Country<'_>) -> Option<Vec<Point>> {
        let seed = self.points[i];
        let reach = 2.5 * self.cell;
        let [w, s, e, n] = country.bounds;
        let mut ring = square(seed, reach);
        for (normal, limit) in [
            ([-1.0, 0.0], -w),
            ([0.0, -1.0], -s),
            ([1.0, 0.0], e),
            ([0.0, 1.0], n),
        ] {
            ring = clip(&ring, normal, limit);
        }
        for j in self.neighbours(seed) {
            if j == i {
                continue;
            }
            let other = self.points[j];
            let normal = unit(sub(other, seed));
            let middle = [(seed[0] + other[0]) / 2.0, (seed[1] + other[1]) / 2.0];
            ring = clip(&ring, normal, dot(middle, normal) - BALK / 2.0);
        }
        for way in country.ways {
            ring = clear_of(ring, seed, way);
        }
        (ring.len() >= 4 && area(&ring) > 0.1 * self.cell * self.cell).then_some(ring)
    }
    fn neighbours(&self, p: Point) -> Vec<usize> {
        let x = ((p[0] - self.origin[0]) / self.cell).floor() as i64;
        let y = ((p[1] - self.origin[1]) / self.cell).floor() as i64;
        let mut found = Vec::new();
        for dy in -2..=2 {
            for dx in -2..=2 {
                let (cx, cy) = (x + dx, y + dy);
                if cx < 0 || cy < 0 || cx as usize >= self.columns || cy as usize >= self.rows {
                    continue;
                }
                found.extend(&self.buckets[cy as usize * self.columns + cx as usize]);
            }
        }
        found
    }
}
/// A block on open ground: as drawn, or drawn in toward its middle until it fits.
fn fit(block: Vec<Point>, ground: &Ground) -> Option<Vec<Point>> {
    let middle = centroid(&block);
    [1.0, 0.95, 0.9, 0.8, 0.7, 0.6].into_iter().find_map(|by| {
        let ring = block
            .iter()
            .map(|&p| {
                [
                    middle[0] + (p[0] - middle[0]) * by,
                    middle[1] + (p[1] - middle[1]) * by,
                ]
            })
            .collect::<Vec<_>>();
        ground.open(&Convex(&ring), u32::MAX).then_some(ring)
    })
}
/// Cuts a block back from each stretch of a way that crosses it, keeping the seed's side.
fn clear_of(mut ring: Vec<Point>, seed: Point, way: &[Point]) -> Vec<Point> {
    for leg in way.windows(2) {
        let (a, b) = (leg[0], leg[1]);
        let crosses = ring
            .windows(2)
            .any(|edge| super::geometry::crossing(a, b, edge[0], edge[1]).is_some());
        if !crosses {
            continue;
        }
        let mut normal = left(unit(sub(b, a)));
        if dot(sub(seed, a), normal) > 0.0 {
            normal = [-normal[0], -normal[1]];
        }
        ring = clip(&ring, normal, dot(a, normal) - VERGE);
        if ring.len() < 4 {
            break;
        }
    }
    ring
}
/// The direction of the way passing nearest `p`, if one passes within reach.
fn nearest_way(p: Point, ways: &[Vec<Point>]) -> Option<Point> {
    ways.iter()
        .flat_map(|way| way.windows(2))
        .map(|leg| {
            (
                segment_distance(p, leg[0], leg[1]),
                unit(sub(leg[1], leg[0])),
            )
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, d)| d)
}
fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let ab = sub(b, a);
    let t = (dot(sub(p, a), ab) / dot(ab, ab).max(1e-12)).clamp(0.0, 1.0);
    distance(p, [a[0] + ab[0] * t, a[1] + ab[1] * t])
}
/// Strips across the block, each running back from a way that runs along `along`.
fn strips(block: &[Point], along: Point, width: f64, jitter: &mut Jitter) -> Vec<Vec<Point>> {
    let reach = block.iter().map(|&p| dot(p, along));
    let (low, high) = reach.fold((f64::MAX, f64::MIN), |(l, h), v| (l.min(v), h.max(v)));
    let back = [-along[0], -along[1]];
    let mut result = Vec::new();
    let mut start = low;
    while start < high {
        let end = (start + width * jitter.around(1.0, 0.35)).min(high);
        let strip = clip(&clip(block, back, -(start + 0.5)), along, end - 0.5);
        if strip.len() >= 4 && area(&strip) > 0.2 * width * width {
            result.push(strip);
        }
        start = end;
    }
    result
}
/// A closed square ring around `centre`.
fn square(centre: Point, half: f64) -> Vec<Point> {
    let [x, y] = centre;
    vec![
        [x - half, y - half],
        [x + half, y - half],
        [x + half, y + half],
        [x - half, y + half],
        [x - half, y - half],
    ]
}
/// The part of a closed convex ring where `p · normal ≤ limit`, closed again.
pub fn clip(ring: &[Point], normal: Point, limit: f64) -> Vec<Point> {
    let inside = |p: Point| dot(p, normal) <= limit;
    let mut out = Vec::new();
    for edge in ring.windows(2) {
        let (a, b) = (edge[0], edge[1]);
        let (da, db) = (dot(a, normal) - limit, dot(b, normal) - limit);
        if inside(a) {
            out.push(a);
        }
        if (da < 0.0) != (db < 0.0) && (da - db).abs() > 1e-12 {
            let t = da / (da - db);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    }
    if let Some(&first) = out.first() {
        out.push(first);
    }
    out
}
/// Area of a closed ring in square metres.
pub fn area(ring: &[Point]) -> f64 {
    ring.windows(2)
        .map(|e| e[0][0] * e[1][1] - e[1][0] * e[0][1])
        .sum::<f64>()
        .abs()
        / 2.0
}
fn centroid(ring: &[Point]) -> Point {
    let corners = &ring[..ring.len().saturating_sub(1)];
    let n = corners.len().max(1) as f64;
    let [x, y] = corners
        .iter()
        .fold([0.0, 0.0], |a, p| [a[0] + p[0], a[1] + p[1]]);
    [x / n, y / n]
}

#[cfg(test)]
mod tests {
    use super::super::ground::Shape;
    use super::*;
    fn country<'a>(places: &'a [(Point, f64)], ways: &'a [Vec<Point>]) -> Country<'a> {
        Country {
            places,
            ways,
            bounds: [0.0, 0.0, 2_000.0, 2_000.0],
            block: 200.0,
            strip: 20.0,
            key: "test",
        }
    }
    #[test]
    fn clipping_keeps_the_part_below_the_line() {
        let half = clip(&square([0.0, 0.0], 1.0), [1.0, 0.0], 0.0);
        assert!((area(&half) - 2.0).abs() < 1e-9);
        assert_eq!(half.first(), half.last());
    }
    #[test]
    fn blocks_vary_in_size_and_never_overlap() {
        let places = [([1_000.0, 1_000.0], 150.0)];
        let mut ground = Ground::new([0.0, 0.0, 2_000.0, 2_000.0], 5.0);
        let fields = fields(&country(&places, &[]), &mut ground, f64::MAX, |_| {
            (0.0, 1.0)
        });
        assert!(fields.len() > 40);
        let areas = fields.iter().map(|f| area(&f.corners)).collect::<Vec<_>>();
        let (low, high) = areas
            .iter()
            .fold((f64::MAX, 0.0_f64), |(l, h), &a| (l.min(a), h.max(a)));
        assert!(high > 2.0 * low, "blocks of one size: {low}..{high}");
        let middles = fields
            .iter()
            .map(|f| centroid(&f.corners))
            .collect::<Vec<_>>();
        for (i, field) in fields.iter().enumerate() {
            for (j, &m) in middles.iter().enumerate() {
                assert!(i == j || !Convex(&field.corners).contains(m));
            }
        }
    }
    #[test]
    fn fields_fill_outward_from_the_built_edge_until_the_farmland_is_met() {
        let places = [([1_000.0, 1_000.0], 150.0)];
        let mut ground = Ground::new([0.0, 0.0, 2_000.0, 2_000.0], 5.0);
        let target = 400_000.0;
        let fields = fields(&country(&places, &[]), &mut ground, target, |p| {
            (1.0, if p[0] < 1_000.0 { 2.0 } else { 0.0 })
        });
        let farmed: f64 = fields.iter().map(|f| area(&f.corners)).sum();
        assert!(farmed >= target * 0.8 && farmed < target + 4.0 * 200.0 * 200.0);
        assert!(fields.iter().any(|f| f.pasture) && fields.iter().any(|f| !f.pasture));
        for field in &fields {
            assert!(distance(centroid(&field.corners), places[0].0) > 150.0);
        }
    }
    #[test]
    fn with_no_place_blocks_are_worked_at_the_farmed_share_and_never_stripped() {
        let mut ground = Ground::new([0.0, 0.0, 2_000.0, 2_000.0], 5.0);
        let all = fields(&country(&[], &[]), &mut ground, f64::MAX, |_| (1.0, 0.0)).len();
        let mut ground = Ground::new([0.0, 0.0, 2_000.0, 2_000.0], 5.0);
        let third = fields(&country(&[], &[]), &mut ground, f64::MAX, |_| (0.3, 0.0));
        let share = third.len() as f64 / all as f64;
        assert!((0.15..0.45).contains(&share), "{} of {all}", third.len());
        let widths = third.iter().map(|f| {
            let xs = f.corners.iter().map(|p| p[0]);
            let (l, h) = xs.fold((f64::MAX, f64::MIN), |(l, h), x| (l.min(x), h.max(x)));
            h - l
        });
        assert!(
            widths.clone().all(|w| w > 40.0),
            "a strip with no place to plough from"
        );
    }
    #[test]
    fn near_arable_is_ploughed_in_strips_back_from_the_way_and_clear_of_it() {
        let places = [([1_000.0, 1_000.0], 150.0)];
        let ways = vec![vec![[0.0, 1_000.0], [2_000.0, 1_000.0]]];
        let mut ground = Ground::new([0.0, 0.0, 2_000.0, 2_000.0], 5.0);
        let fields = fields(&country(&places, &ways), &mut ground, f64::MAX, |_| {
            (1.0, 0.0)
        });
        let narrow = fields
            .iter()
            .filter(|f| {
                let xs = f.corners.iter().map(|p| p[0]);
                let (l, h) = xs.fold((f64::MAX, f64::MIN), |(l, h), x| (l.min(x), h.max(x)));
                h - l < 40.0
            })
            .count();
        assert!(
            narrow > fields.len() / 2,
            "{narrow} of {} strips",
            fields.len()
        );
        for field in &fields {
            assert!(field
                .corners
                .iter()
                .all(|p| (p[1] - 1_000.0).abs() >= VERGE - 1e-6));
        }
    }
}
