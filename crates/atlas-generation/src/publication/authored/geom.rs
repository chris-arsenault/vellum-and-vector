//! Plane geometry for authored terrain: falloff curves, segment distance and polygon fill.
use super::Rect;
use crate::publication::raster::RasterGrid;

pub type Ring = Vec<[f64; 2]>;

/// Map position of a pixel centre; row 0 is the north edge.
pub fn centre(grid: RasterGrid, col: u32, row: u32) -> (f64, f64) {
    let [dx, dy] = grid.pixel_span();
    (
        grid.bounds.0 + (f64::from(col) + 0.5) * dx,
        grid.bounds.3 - (f64::from(row) + 0.5) * dy,
    )
}
/// Weight 1 at `t = 0` easing smoothly to 0 at `t = 1`.
pub fn falloff(t: f64) -> f64 {
    if t >= 1.0 {
        return 0.0;
    }
    let s = 1.0 - t.max(0.0);
    s * s * (3.0 - 2.0 * s)
}
/// Distance from `p` to segment `a`-`b` and the fraction along it of the nearest point.
pub fn nearest_on_segment(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> (f64, f64) {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let length2 = dx * dx + dy * dy;
    let t = if length2 > 0.0 {
        (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    ((p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy), t)
}
/// Every closed edge of every ring.
pub fn edges(rings: &[Ring]) -> impl Iterator<Item = ([f64; 2], [f64; 2])> + '_ {
    rings
        .iter()
        .flat_map(|ring| (0..ring.len()).map(move |i| (ring[i], ring[(i + 1) % ring.len()])))
}
pub fn distance_to_edges(rings: &[Ring], p: [f64; 2]) -> f64 {
    edges(rings)
        .map(|(a, b)| nearest_on_segment(a, b, p).0)
        .fold(f64::INFINITY, f64::min)
}
fn crossings(rings: &[Ring], y: f64, xs: &mut Vec<f64>) {
    xs.clear();
    for (a, b) in edges(rings) {
        if (a[1] <= y) != (b[1] <= y) {
            xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
    }
    // hpc-exempt: the few edge crossings of one scanline, ordered for even-odd filling.
    xs.sort_by(f64::total_cmp);
}
/// Pixels of `rect` whose centre lies inside the rings (even-odd, so later rings are holes),
/// row by row from `rect`'s north edge.
pub fn fill_mask(grid: RasterGrid, rings: &[Ring], rect: Rect) -> Vec<bool> {
    let width = rect.width() as usize;
    let mut mask = vec![false; rect.area()];
    let [dx, dy] = grid.pixel_span();
    let first_col = |x: f64| ((x - grid.bounds.0) / dx - 0.5).ceil() as i64;
    let mut xs = Vec::new();
    for row in rect.row0..rect.row1 {
        crossings(rings, grid.bounds.3 - (f64::from(row) + 0.5) * dy, &mut xs);
        for pair in xs.as_chunks::<2>().0 {
            let lo = first_col(pair[0]).max(i64::from(rect.col0));
            let hi = first_col(pair[1]).min(i64::from(rect.col1));
            let base = (row - rect.row0) as usize * width;
            for col in lo..hi {
                mask[base + (col - i64::from(rect.col0)) as usize] = true;
            }
        }
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_map::Bounds;

    fn grid() -> RasterGrid {
        RasterGrid {
            width: 10,
            height: 10,
            bounds: Bounds(0.0, 0.0, 100.0, 100.0),
        }
    }
    #[test]
    fn falloff_is_one_at_centre_and_zero_at_rim() {
        assert_eq!(falloff(0.0), 1.0);
        assert_eq!(falloff(1.0), 0.0);
        assert!(falloff(0.5) > 0.4 && falloff(0.5) < 0.6);
    }
    #[test]
    fn segment_distance_clamps_to_the_ends() {
        let (d, t) = nearest_on_segment([0.0, 0.0], [10.0, 0.0], [5.0, 3.0]);
        assert!((d - 3.0).abs() < 1e-9 && (t - 0.5).abs() < 1e-9);
        let (d, t) = nearest_on_segment([0.0, 0.0], [10.0, 0.0], [13.0, 4.0]);
        assert!((d - 5.0).abs() < 1e-9 && t == 1.0);
    }
    #[test]
    fn fill_mask_honours_holes() {
        let outer = vec![[20.0, 20.0], [80.0, 20.0], [80.0, 80.0], [20.0, 80.0]];
        let hole = vec![[40.0, 40.0], [60.0, 40.0], [60.0, 60.0], [40.0, 60.0]];
        let rect = Rect {
            col0: 0,
            row0: 0,
            col1: 10,
            row1: 10,
        };
        let mask = fill_mask(grid(), &[outer, hole], rect);
        let at = |col: usize, row: usize| mask[row * 10 + col];
        assert!(at(2, 2) && at(7, 7));
        assert!(!at(5, 5) && !at(0, 0) && !at(9, 9));
        assert_eq!(mask.iter().filter(|&&m| m).count(), 36 - 4);
    }
}
