//! Single objects and scatters of clutter (ADR 0016). An object is an outline of its kind's
//! real size, turned and scaled where it is placed; a scatter fills a drawn outline with
//! objects at a spacing, from a seed, so the same request lays the same objects.
use crate::{Geometry, KindSize, MapDescriptor, Position};

/// A kind's true size as the map's published catalogue states it (the catalogue's true-size
/// slot, published on the layer's feature types).
pub fn kind_size(map: &MapDescriptor, layer_id: &str, kind: &str) -> Option<KindSize> {
    map.layers
        .iter()
        .filter(|layer| layer.id == layer_id)
        .flat_map(|layer| &layer.catalog.feature_types)
        .find(|entry| entry.kind == kind)
        .and_then(|entry| entry.true_size)
}
/// The outline of one object of a typical size centred on `at`: its length (breadth times
/// elongation) turned `rotation` degrees counter-clockwise from east, all scaled by `scale`.
pub fn object_outline(size: &KindSize, [cx, cy]: [f64; 2], rotation: f64, scale: f64) -> Geometry {
    let (a, b) = (
        size.typical * size.elongation * scale / 2.0,
        size.typical * scale / 2.0,
    );
    let corners: Vec<(f64, f64)> = if size.round {
        (0..8)
            .map(|i| {
                let t = f64::from(i) * std::f64::consts::FRAC_PI_4;
                (a * t.cos(), b * t.sin())
            })
            .collect()
    } else {
        vec![(-a, -b), (a, -b), (a, b), (-a, b)]
    };
    let (sin, cos) = rotation.to_radians().sin_cos();
    let mut ring: Vec<Position> = corners
        .into_iter()
        .map(|(x, y)| Position::xy(cx + x * cos - y * sin, cy + x * sin + y * cos))
        .collect();
    ring.push(ring[0]);
    Geometry::Polygon {
        coordinates: vec![ring],
    }
}

/// A small seeded generator (SplitMix64): the same seed gives the same sequence everywhere.
pub struct Seeded(u64);
impl Seeded {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }
    /// The next value in [0, 1).
    pub fn draw(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Points over a rectangle no two closer than `spacing`, filled until no gap is left for
/// another (Bridson's Poisson-disc sampling). The same seed lays the same points.
pub fn poisson_points(bounds: crate::Bounds, spacing: f64, seed: u64) -> Vec<[f64; 2]> {
    let crate::Bounds(w, s, e, n) = bounds;
    if spacing.is_nan() || spacing <= 0.0 || e <= w || n <= s {
        return Vec::new();
    }
    let cell = spacing / std::f64::consts::SQRT_2;
    let columns = ((e - w) / cell).ceil() as usize + 1;
    let rows = ((n - s) / cell).ceil() as usize + 1;
    let mut grid: Vec<Option<usize>> = vec![None; columns * rows];
    let slot = |[x, y]: [f64; 2]| ((x - w) / cell) as usize + ((y - s) / cell) as usize * columns;
    let mut random = Seeded::new(seed);
    let first = [w + random.draw() * (e - w), s + random.draw() * (n - s)];
    let mut points = vec![first];
    grid[slot(first)] = Some(0);
    let mut active = vec![0];
    while !active.is_empty() {
        let pick = (random.draw() * active.len() as f64) as usize % active.len();
        let [px, py] = points[active[pick]];
        let found = (0..30).find_map(|_| {
            let angle = random.draw() * std::f64::consts::TAU;
            let reach = spacing * (1.0 + random.draw());
            let candidate = [px + reach * angle.cos(), py + reach * angle.sin()];
            let [cx, cy] = candidate;
            let inside = cx >= w && cx < e && cy >= s && cy < n;
            (inside
                && clear(
                    &points,
                    &grid,
                    candidate,
                    spacing,
                    cell,
                    [w, s],
                    columns,
                    rows,
                ))
            .then_some(candidate)
        });
        match found {
            Some(candidate) => {
                grid[slot(candidate)] = Some(points.len());
                active.push(points.len());
                points.push(candidate);
            }
            None => {
                active.swap_remove(pick);
            }
        }
    }
    points
}
#[allow(clippy::too_many_arguments)]
fn clear(
    points: &[[f64; 2]],
    grid: &[Option<usize>],
    [x, y]: [f64; 2],
    spacing: f64,
    cell: f64,
    [w, s]: [f64; 2],
    columns: usize,
    rows: usize,
) -> bool {
    let (col, row) = (((x - w) / cell) as usize, ((y - s) / cell) as usize);
    for r in row.saturating_sub(2)..(row + 3).min(rows) {
        for c in col.saturating_sub(2)..(col + 3).min(columns) {
            if let Some(index) = grid[c + r * columns] {
                let [ox, oy] = points[index];
                if (ox - x).hypot(oy - y) < spacing {
                    return false;
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Bounds;

    #[test]
    fn scattered_points_keep_their_spacing_and_fill_the_ground() {
        let points = poisson_points(Bounds(0.0, 0.0, 20.0, 10.0), 1.5, 7);
        for (i, a) in points.iter().enumerate() {
            for b in &points[i + 1..] {
                assert!((a[0] - b[0]).hypot(a[1] - b[1]) >= 1.5);
            }
        }
        // A full Poisson-disc fill holds roughly one point per 1.2–2.5 spacing² of ground.
        let per_point = 200.0 / points.len() as f64;
        assert!(
            per_point > 1.2 * 2.25 && per_point < 2.5 * 2.25,
            "{per_point}"
        );
    }
    #[test]
    fn the_same_seed_repeats_the_scatter_and_another_seed_changes_it() {
        let ground = Bounds(0.0, 0.0, 12.0, 12.0);
        assert_eq!(
            poisson_points(ground, 2.0, 3),
            poisson_points(ground, 2.0, 3)
        );
        assert_ne!(
            poisson_points(ground, 2.0, 3),
            poisson_points(ground, 2.0, 4)
        );
    }
    #[test]
    fn an_object_outline_is_its_kinds_size_turned_and_scaled() {
        let log = KindSize {
            least: 0.2,
            typical: 0.5,
            largest: 1.5,
            elongation: 8.0,
            round: false,
        };
        let Geometry::Polygon { coordinates } = object_outline(&log, [10.0, 5.0], 90.0, 2.0) else {
            panic!("an object is an outline")
        };
        let ring = &coordinates[0];
        assert_eq!(ring.len(), 5);
        let ys: Vec<f64> = ring.iter().map(|p| p.coordinates()[1]).collect();
        let xs: Vec<f64> = ring.iter().map(|p| p.coordinates()[0]).collect();
        let span = |v: &[f64]| {
            v.iter().cloned().fold(f64::MIN, f64::max) - v.iter().cloned().fold(f64::MAX, f64::min)
        };
        // A 4 m log doubled and turned to run north: 8 m north to south, 1 m across.
        assert!((span(&ys) - 8.0).abs() < 1e-9);
        assert!((span(&xs) - 1.0).abs() < 1e-9);
        let round = object_outline(&KindSize { round: true, ..log }, [0.0, 0.0], 0.0, 1.0);
        let Geometry::Polygon { coordinates } = round else {
            panic!("an object is an outline")
        };
        assert_eq!(coordinates[0].len(), 9);
    }
}
