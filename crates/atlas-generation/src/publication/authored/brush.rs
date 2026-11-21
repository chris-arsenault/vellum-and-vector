//! Brush strokes and height shapes written into the terrain grid.
use super::{
    geom::{self, falloff},
    shape::{HeightArea, HeightLine, HeightPeak, Rect, Stroke},
    BrushMode, Terrain,
};
use std::io;

fn blend(old: f32, goal: f32, weight: f64) -> f32 {
    old + (goal - old) * weight as f32
}
/// Dab centres along the polyline, no further apart than `spacing`.
fn stamps(points: &[[f64; 2]], spacing: f64) -> Vec<[f64; 2]> {
    let mut out = vec![points[0]];
    let mut since = 0.0;
    for pair in points.windows(2) {
        let (dx, dy) = (pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]);
        let length = dx.hypot(dy);
        let mut at = spacing - since;
        while at <= length {
            out.push([pair[0][0] + dx * at / length, pair[0][1] + dy * at / length]);
            at += spacing;
        }
        since = length - (at - spacing);
    }
    if points.len() > 1 {
        out.push(points[points.len() - 1]);
    }
    out
}
impl Terrain {
    fn disc(&self, c: [f64; 2], r: f64) -> Rect {
        self.extent(c[0] - r, c[1] - r, c[0] + r, c[1] + r)
    }
    fn neighbour_mean(&self, col: u32, row: u32) -> f32 {
        let (mut sum, mut n) = (0.0, 0.0);
        for r in row.saturating_sub(1)..=(row + 1).min(self.grid.height - 1) {
            for c in col.saturating_sub(1)..=(col + 1).min(self.grid.width - 1) {
                sum += self.heights[self.index(c, r)];
                n += 1.0;
            }
        }
        sum / n
    }
    /// One round dab: `update(grid, cell, col, row, t)` gives each covered cell's new height from
    /// its distance `t` (0 at the centre, 1 at the rim) in radii, all read before any is written.
    fn dab(
        &mut self,
        c: [f64; 2],
        r: f64,
        update: impl Fn(&Self, usize, u32, u32, f64) -> f32,
    ) -> Rect {
        let rect = self.disc(c, r);
        let mut changes = Vec::new();
        for row in rect.row0..rect.row1 {
            for col in rect.col0..rect.col1 {
                let (x, y) = self.cell_centre(col, row);
                let d = (x - c[0]).hypot(y - c[1]);
                if d < r {
                    let cell = self.index(col, row);
                    changes.push((cell, update(self, cell, col, row, d / r)));
                }
            }
        }
        for (cell, height) in changes {
            self.set_clamped(cell, height);
        }
        rect
    }
    /// Stamp the stroke; returns the pixel rectangle that may have changed.
    pub fn brush(&mut self, stroke: &Stroke) -> io::Result<Rect> {
        stroke.validate()?;
        let (s, step, goal) = (stroke.strength, stroke.step_height, stroke.target);
        let mut changed = Rect::default();
        for at in stamps(&stroke.points, stroke.radius / 3.0) {
            let rect = self.dab(at, stroke.radius, |t, cell, col, row, d| {
                let (old, w) = (t.heights[cell], falloff(d));
                match stroke.mode {
                    BrushMode::Raise => old + step * (s * w) as f32,
                    BrushMode::Lower => old - step * (s * w) as f32,
                    BrushMode::Smooth => blend(old, t.neighbour_mean(col, row), s * w),
                    BrushMode::Flatten => blend(old, goal, s * w),
                    BrushMode::Set => blend(old, goal, w),
                }
            });
            changed = changed.union(rect);
        }
        Ok(changed)
    }
    /// Pull cells near the line toward the height interpolated at their nearest point on it.
    pub fn apply_line(&mut self, line: &HeightLine) -> io::Result<Rect> {
        line.validate()?;
        let hw = line.half_width;
        let pts = &line.points;
        let segments = pts.len().saturating_sub(1).max(1);
        let reach = |i: usize| {
            let (a, b) = (pts[i], pts[(i + 1).min(pts.len() - 1)]);
            self.extent(
                a[0].min(b[0]) - hw,
                a[1].min(b[1]) - hw,
                a[0].max(b[0]) + hw,
                a[1].max(b[1]) + hw,
            )
        };
        let changed = (1..segments).fold(reach(0), |all, i| all.union(reach(i)));
        // The nearest point of the line per cell of the line's reach, dense over that rect.
        let mut nearest =
            vec![(f64::INFINITY, 0.0_f32); changed.width() as usize * changed.height() as usize];
        for i in 0..segments {
            let (a, b) = (pts[i], pts[(i + 1).min(pts.len() - 1)]);
            let (h0, h1) = (line.heights[i], line.heights[(i + 1).min(pts.len() - 1)]);
            let rect = reach(i);
            for row in rect.row0..rect.row1 {
                for col in rect.col0..rect.col1 {
                    let (x, y) = self.cell_centre(col, row);
                    let (d, t) = geom::nearest_on_segment(a, b, [x, y]);
                    let at = (row - changed.row0) as usize * changed.width() as usize
                        + (col - changed.col0) as usize;
                    if d < hw && d < nearest[at].0 {
                        nearest[at] = (d, blend(h0, h1, t));
                    }
                }
            }
        }
        for row in changed.row0..changed.row1 {
            for col in changed.col0..changed.col1 {
                let at = (row - changed.row0) as usize * changed.width() as usize
                    + (col - changed.col0) as usize;
                let (d, target) = nearest[at];
                if d.is_finite() {
                    let cell = self.index(col, row);
                    self.set_clamped(cell, blend(self.heights[cell], target, falloff(d / hw)));
                }
            }
        }
        Ok(changed)
    }
    /// Set the polygon's cells to its height, with a soft skirt of `feather` outside the edge.
    pub fn apply_area(&mut self, area: &HeightArea) -> io::Result<Rect> {
        area.validate()?;
        let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
        for p in area.rings.iter().flatten() {
            for k in 0..2 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        let f = area.feather;
        let rect = self.extent(lo[0] - f, lo[1] - f, hi[0] + f, hi[1] + f);
        let inside = geom::fill_mask(self.grid, &area.rings, rect);
        for row in rect.row0..rect.row1 {
            for col in rect.col0..rect.col1 {
                let weight = if inside[(row - rect.row0) as usize * rect.width() as usize
                    + (col - rect.col0) as usize]
                {
                    1.0
                } else if f > 0.0 {
                    let (x, y) = self.cell_centre(col, row);
                    falloff(geom::distance_to_edges(&area.rings, [x, y]) / f)
                } else {
                    0.0
                };
                if weight > 0.0 {
                    let cell = self.index(col, row);
                    self.set_clamped(cell, blend(self.heights[cell], area.height, weight));
                }
            }
        }
        Ok(rect)
    }
    /// Raise a cosine bump toward the peak height; cells already higher stay.
    pub fn apply_peak(&mut self, peak: &HeightPeak) -> io::Result<Rect> {
        peak.validate()?;
        Ok(self.dab(peak.at, peak.radius, |t, cell, _, _, d| {
            let bump = peak.height * (0.5 + 0.5 * (std::f64::consts::PI * d).cos()) as f32;
            t.heights[cell].max(bump)
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::super::fixtures::{grid, square};
    use super::*;

    fn raise(at: [f64; 2], radius: f64) -> Stroke {
        Stroke {
            points: vec![at],
            radius,
            strength: 1.0,
            mode: BrushMode::Raise,
            target: 0.0,
            step_height: 100.0,
        }
    }
    #[test]
    fn raise_changes_only_cells_within_the_radius() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let before = t.heights().to_vec();
        let rect = t.brush(&raise([200.0, 150.0], 30.0)).unwrap();
        assert_eq!(
            rect,
            Rect {
                col0: 17,
                row0: 12,
                col1: 24,
                row1: 19
            }
        );
        for row in 0..30 {
            for col in 0..40 {
                let (x, y) = t.cell_centre(col, row);
                let near = (x - 200.0).hypot(y - 150.0) < 30.0;
                let i = (row * 40 + col) as usize;
                assert_eq!(t.heights()[i] != before[i], near, "cell {col},{row}");
                if near {
                    assert!(
                        (rect.col0..rect.col1).contains(&col)
                            && (rect.row0..rect.row1).contains(&row)
                    );
                }
            }
        }
    }
    #[test]
    fn smoothing_reduces_a_spike() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let spike = t.index(20, 15);
        t.set_clamped(spike, 1000.0);
        let mut stroke = raise([205.0, 145.0], 30.0);
        stroke.mode = BrushMode::Smooth;
        stroke.strength = 0.8;
        t.brush(&stroke).unwrap();
        assert!(t.heights()[spike] < 800.0);
        assert!(t.heights()[t.index(21, 15)] > -4000.0);
    }
    #[test]
    fn flatten_and_set_go_toward_the_target() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let mut stroke = raise([205.0, 145.0], 40.0);
        stroke.mode = BrushMode::Set;
        stroke.target = 50.0;
        t.brush(&stroke).unwrap();
        assert!((t.heights()[t.index(20, 15)] - 50.0).abs() < 1.0);
        assert!(stroke.points.len() == 1);
    }
    #[test]
    fn long_strokes_leave_no_gaps() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let mut stroke = raise([50.0, 150.0], 20.0);
        stroke.points.push([350.0, 150.0]);
        t.brush(&stroke).unwrap();
        for col in 6..34 {
            assert!(t.heights()[t.index(col, 15)] > -4000.0, "col {col}");
        }
    }
    #[test]
    fn invalid_strokes_change_nothing() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let mut stroke = raise([200.0, 150.0], f64::NAN);
        assert!(t.brush(&stroke).is_err());
        stroke.radius = 10.0;
        stroke.points.clear();
        assert!(t.brush(&stroke).is_err());
        assert!(t.heights().iter().all(|&h| h == -4000.0));
    }
    #[test]
    fn line_interpolates_its_vertex_heights() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let line = HeightLine {
            points: vec![[25.0, 145.0], [375.0, 145.0]],
            heights: vec![100.0, 500.0],
            half_width: 20.0,
        };
        t.apply_line(&line).unwrap();
        let h = |col| t.heights()[t.index(col, 15)];
        assert!((h(2) - (100.0 + 400.0 * (25.0 - 25.0) / 350.0)).abs() < 1.0);
        assert!((h(20) - (100.0 + 400.0 * (205.0 - 25.0) / 350.0)).abs() < 1.0);
        assert!((h(37) - 500.0).abs() < 1.0);
        assert_eq!(t.heights()[t.index(20, 25)], -4000.0);
        assert!(t.heights()[t.index(20, 14)] > -4000.0);
    }
    #[test]
    fn area_is_hard_or_feathered_at_its_edge() {
        let ring = square(100.0, 100.0, 200.0, 200.0);
        let mut hard = Terrain::ocean(grid()).unwrap();
        let hard_area = HeightArea {
            rings: vec![ring.clone()],
            height: 800.0,
            feather: 0.0,
        };
        hard.apply_area(&hard_area).unwrap();
        assert_eq!(hard.heights()[hard.index(15, 15)], 800.0);
        assert_eq!(hard.heights()[hard.index(9, 15)], -4000.0);
        let mut soft = Terrain::ocean(grid()).unwrap();
        soft.apply_area(&HeightArea {
            feather: 40.0,
            ..hard_area
        })
        .unwrap();
        assert_eq!(soft.heights()[soft.index(15, 15)], 800.0);
        let skirt = soft.heights()[soft.index(9, 15)];
        assert!(skirt > -4000.0 && skirt < 800.0);
        assert_eq!(soft.heights()[soft.index(4, 15)], -4000.0);
    }
    #[test]
    fn peak_raises_a_bump_and_keeps_higher_ground() {
        let mut t = Terrain::ocean(grid()).unwrap();
        let high = t.index(30, 15);
        t.set_clamped(high, 5000.0);
        let peak = HeightPeak {
            at: [205.0, 145.0],
            height: 2000.0,
            radius: 60.0,
        };
        t.apply_peak(&peak).unwrap();
        assert!((t.heights()[t.index(20, 15)] - 2000.0).abs() < 1.0);
        assert!(t.heights()[t.index(22, 15)] < 2000.0);
        assert_eq!(t.heights()[t.index(20, 25)], -4000.0);
        t.apply_peak(&HeightPeak {
            at: [305.0, 145.0],
            height: 1000.0,
            radius: 30.0,
        })
        .unwrap();
        assert_eq!(t.heights()[high], 5000.0);
    }
}
