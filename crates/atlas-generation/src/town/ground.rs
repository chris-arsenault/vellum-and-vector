//! The plan's working grid: which ground is water, steep or outside the map, and which street,
//! square or plot already holds each cell, so laid shapes never overlap.
use super::geometry::{add, at, distance, line_length, scale, sub, Point};

pub const FREE: u32 = 0;
pub const WATER: u32 = 1;
pub const STEEP: u32 = 2;
pub const OUTSIDE: u32 = 3;
pub const SQUARE: u32 = 4;
pub const WALL: u32 = 5;
pub const FIELD: u32 = 6;
pub const PLOT: u32 = 7;
/// A way on the map that is not one of the settlement's streets: a captured road or trail.
pub const WAY: u32 = 8;
/// The first owner a street can take; street `i` owns `FIRST_STREET + i`.
pub const FIRST_STREET: u32 = 9;

#[derive(Clone)]
pub struct Ground {
    pub(super) walks: std::cell::OnceCell<std::rc::Rc<super::access::walking::Mesh>>,
    pub origin: Point,
    pub cell: f64,
    pub columns: usize,
    pub rows: usize,
    owners: Vec<u32>,
    hillside: Vec<[f32; 2]>,
}
/// A shape laid on the ground: what it covers, its extent and the points the grid checks.
pub trait Shape {
    fn contains(&self, p: Point) -> bool;
    fn bounds(&self) -> [f64; 4];
    fn samples(&self, cell: f64) -> Vec<Point>;
}
/// A convex outline given as a closed ring, either winding.
pub struct Convex<'a>(pub &'a [Point]);
impl Shape for Convex<'_> {
    fn contains(&self, p: Point) -> bool {
        let r = self.0;
        let side = |a: Point, b: Point| {
            let (ab, ap) = (sub(b, a), sub(p, a));
            ab[0] * ap[1] - ab[1] * ap[0]
        };
        let sides = r.windows(2).map(|w| side(w[0], w[1]));
        let (mut left, mut right) = (false, false);
        for s in sides {
            left |= s > 0.0;
            right |= s < 0.0;
        }
        !(left && right)
    }
    fn bounds(&self) -> [f64; 4] {
        extent(self.0)
    }
    /// The middle and every corner drawn a cell and a half toward it.
    fn samples(&self, cell: f64) -> Vec<Point> {
        let corners = &self.0[..self.0.len().saturating_sub(1)];
        let m = scale(
            corners.iter().fold([0.0, 0.0], |a, &p| add(a, p)),
            1.0 / corners.len().max(1) as f64,
        );
        let mut points = vec![m];
        for &c in corners {
            let reach = distance(c, m).max(1e-9);
            points.push(add(c, scale(sub(m, c), (1.42 * cell / reach).min(0.45))));
        }
        points
    }
}
fn extent(points: &[Point]) -> [f64; 4] {
    points.iter().fold(
        [f64::MAX, f64::MAX, f64::MIN, f64::MIN],
        |[w, s, e, n], p| [w.min(p[0]), s.min(p[1]), e.max(p[0]), n.max(p[1])],
    )
}
/// A turned rectangle given by its corners (closed ring of five points).
pub struct Rectangle<'a>(pub &'a [Point]);
impl Shape for Rectangle<'_> {
    fn contains(&self, p: Point) -> bool {
        let r = self.0;
        let (a, b, d) = (r[0], r[1], r[3]);
        let ab = sub(b, a);
        let ad = sub(d, a);
        let ap = sub(p, a);
        let u = (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1]);
        let v = (ap[0] * ad[0] + ap[1] * ad[1]) / (ad[0] * ad[0] + ad[1] * ad[1]);
        (0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v)
    }
    fn bounds(&self) -> [f64; 4] {
        extent(self.0)
    }
    /// The middle and the corners drawn in far enough that the grid cell holding each one
    /// has its centre inside the rectangle, so neighbours that only touch never clash.
    fn samples(&self, cell: f64) -> Vec<Point> {
        let r = self.0;
        let shortest = distance(r[0], r[1]).min(distance(r[1], r[2])).max(1e-9);
        let inset = (1.42 * cell / shortest).min(0.45);
        let m = scale(add(r[0], r[2]), 0.5);
        vec![
            m,
            add(r[0], scale(sub(m, r[0]), inset)),
            add(r[1], scale(sub(m, r[1]), inset)),
            add(r[2], scale(sub(m, r[2]), inset)),
            add(r[3], scale(sub(m, r[3]), inset)),
        ]
    }
}
impl Ground {
    /// A free grid over `bounds` (west, south, east, north) at `cell` metres.
    pub fn new(bounds: [f64; 4], cell: f64) -> Self {
        let columns = ((bounds[2] - bounds[0]) / cell).ceil().max(1.0) as usize;
        let rows = ((bounds[3] - bounds[1]) / cell).ceil().max(1.0) as usize;
        Self {
            origin: [bounds[0], bounds[1]],
            walks: Default::default(),
            cell,
            columns,
            rows,
            owners: vec![FREE; columns * rows],
            hillside: vec![[0.; 2]; columns * rows],
        }
    }
    pub fn index(&self, p: Point) -> Option<usize> {
        let x = ((p[0] - self.origin[0]) / self.cell).floor();
        let y = ((p[1] - self.origin[1]) / self.cell).floor();
        (x >= 0.0 && y >= 0.0 && (x as usize) < self.columns && (y as usize) < self.rows)
            .then(|| y as usize * self.columns + x as usize)
    }
    pub fn centre(&self, index: usize) -> Point {
        [
            self.origin[0] + ((index % self.columns) as f64 + 0.5) * self.cell,
            self.origin[1] + ((index / self.columns) as f64 + 0.5) * self.cell,
        ]
    }
    pub fn count(&self) -> usize {
        self.owners.len()
    }
    pub fn owner(&self, p: Point) -> u32 {
        self.index(p).map_or(OUTSIDE, |i| self.owners[i])
    }
    pub fn owner_at(&self, index: usize) -> u32 {
        self.owners[index]
    }
    pub fn set_hillside(&mut self, index: usize, gradient: Point) {
        self.hillside[index] = gradient.map(|g| g as f32);
    }
    pub fn passes_hillside(&self, p: Point, direction: Point) -> bool {
        self.index(p).is_some_and(|i| {
            let gradient = self.hillside[i].map(f64::from);
            gradient != [0.; 2]
                && super::geometry::dot(gradient, direction).abs() <= super::settings::STEEP_SLOPE
        })
    }
    /// Marks ground the terrain withholds (water, steep, outside); later marks never clear it.
    pub fn withhold(&mut self, index: usize, mark: u32) {
        if self.owners[index] == FREE
            || (mark == WATER && self.owners[index] != OUTSIDE)
            || (self.owners[index] == STEEP && matches!(mark, WALL | PLOT | SQUARE))
        {
            self.walks.take();
            self.owners[index] = mark;
        }
    }
    /// The cells whose centres lie within `bounds` (west, south, east, north).
    pub fn cells_within(&self, [w, s, e, n]: [f64; 4]) -> Vec<usize> {
        let column = |x: f64| ((x - self.origin[0]) / self.cell - 0.5).ceil().max(0.0) as usize;
        let row = |y: f64| ((y - self.origin[1]) / self.cell - 0.5).ceil().max(0.0) as usize;
        let last = |v: f64, origin: f64, count: usize| {
            (((v - origin) / self.cell - 0.5).floor() as i64).min(count as i64 - 1)
        };
        let (east, north) = (
            last(e, self.origin[0], self.columns),
            last(n, self.origin[1], self.rows),
        );
        let mut cells = Vec::new();
        for y in row(s) as i64..=north {
            for x in column(w) as i64..=east {
                cells.push(y as usize * self.columns + x as usize);
            }
        }
        cells
    }
    /// Withholds every cell whose centre one of the shapes covers, as water or steep ground.
    pub fn mark_shapes(
        &mut self,
        shapes: &[atlas_map::Geometry],
        mark: u32,
        spatial: &dyn crate::spatial::SpatialKernel,
    ) -> std::io::Result<()> {
        for shape in shapes {
            let atlas_map::Bounds(w, s, e, n) =
                spatial.bounds(shape).map_err(std::io::Error::other)?;
            let cells = self.cells_within([w, s, e, n]);
            let centres: Vec<atlas_map::Position> = cells
                .iter()
                .map(|&i| {
                    let [x, y] = self.centre(i);
                    atlas_map::Position::xy(x, y)
                })
                .collect();
            let covered = spatial
                .covers_points(shape, &centres)
                .map_err(std::io::Error::other)?;
            for (index, inside) in cells.into_iter().zip(covered) {
                if inside {
                    self.withhold(index, mark);
                }
            }
        }
        Ok(())
    }
    pub fn is_water(&self, p: Point) -> bool {
        self.owner(p) == WATER
    }
    pub fn release_shape(
        &mut self,
        shape: &atlas_map::Geometry,
        owner: u32,
        spatial: &dyn crate::spatial::SpatialKernel,
    ) -> std::io::Result<()> {
        let atlas_map::Bounds(w, s, e, n) = spatial.bounds(shape).map_err(std::io::Error::other)?;
        let cells = self.cells_within([w, s, e, n]);
        let points: Vec<_> = cells
            .iter()
            .map(|&i| {
                let p = self.centre(i);
                atlas_map::Position::xy(p[0], p[1])
            })
            .collect();
        let covered = spatial
            .covers_points(shape, &points)
            .map_err(std::io::Error::other)?;
        for (cell, inside) in cells.into_iter().zip(covered) {
            if inside && self.owners[cell] == owner {
                self.walks.take();
                self.owners[cell] = if self.hillside[cell] == [0.; 2] {
                    FREE
                } else {
                    STEEP
                };
            }
        }
        Ok(())
    }
    fn cells_in(&self, rectangle: &impl Shape) -> Vec<usize> {
        let [w, s, e, n] = rectangle.bounds();
        let column = |x: f64| ((x - self.origin[0]) / self.cell).floor().max(0.0) as usize;
        let row = |y: f64| ((y - self.origin[1]) / self.cell).floor().max(0.0) as usize;
        let mut cells = Vec::new();
        for y in row(s)..=row(n).min(self.rows.saturating_sub(1)) {
            for x in column(w)..=column(e).min(self.columns.saturating_sub(1)) {
                let index = y * self.columns + x;
                if rectangle.contains(self.centre(index)) {
                    cells.push(index);
                }
            }
        }
        cells
    }
    /// Whether a shape lies on free ground, or ground its own street holds, everywhere
    /// the grid can see: at cell centres inside it and near its corners and middle.
    pub fn open(&self, rectangle: &impl Shape, street: u32) -> bool {
        let fits = |owner: u32| owner == FREE || owner == street;
        self.open_with(rectangle, fits)
    }
    pub fn open_with(&self, rectangle: &impl Shape, fits: impl Fn(u32) -> bool) -> bool {
        let corners = rectangle
            .samples(self.cell)
            .into_iter()
            .all(|p| fits(self.owner(p)));
        corners
            && self
                .cells_in(rectangle)
                .into_iter()
                .all(|i| fits(self.owners[i]))
    }
    /// Gives the free cells of a shape to `owner`.
    pub fn take(&mut self, rectangle: &impl Shape, owner: u32) {
        let cells = self.cells_in(rectangle);
        for p in rectangle.samples(self.cell) {
            if let Some(i) = self.index(p) {
                self.claim(i, owner);
            }
        }
        for i in cells {
            self.claim(i, owner);
        }
    }
    fn claim(&mut self, index: usize, owner: u32) {
        if self.owners[index] == FREE {
            self.walks.take();
            self.owners[index] = owner;
        }
    }
    /// Gives a street's free ground, `width` metres wide along its line and half a cell past
    /// each end, to `owner`. A street also takes the cells another street holds there, so a
    /// side street's mouth belongs to it and no plot of the street it leaves stands in it.
    pub fn take_line(&mut self, points: &[Point], width: f64, owner: u32) {
        self.take_profile(points, |_| width, owner);
    }
    pub fn take_street(&mut self, street: &super::network::Street, owner: u32) {
        let margin = self.cell;
        self.take_profile(
            &street.points,
            |along| street.width_at(along) + margin,
            owner,
        );
    }
    fn take_profile(&mut self, points: &[Point], width: impl Fn(f64) -> f64, owner: u32) {
        let step = self.cell / 2.0;
        let total = line_length(points);
        let mut along = -step;
        while along <= total + step {
            let on = along.clamp(0.0, total);
            if let Some((p, d)) = at(points, on) {
                let p = add(p, scale(d, along - on));
                let width = width(on);
                let across = [-d[1], d[0]];
                let mut side = -width / 2.0;
                while side <= width / 2.0 {
                    if let Some(i) = self.index(add(p, scale(across, side))) {
                        if owner >= FIRST_STREET
                            && (self.owners[i] >= FIRST_STREET || self.owners[i] == STEEP)
                        {
                            self.walks.take();
                            self.owners[i] = owner;
                        }
                        self.claim(i, owner);
                    }
                    side += step;
                }
            }
            along += step;
        }
    }
    /// Runs of a line over water, as (start, end) metres along it.
    pub fn wet_runs(&self, points: &[Point]) -> Vec<(f64, f64)> {
        let step = self.cell / 2.0;
        let total = line_length(points);
        let mut runs = Vec::new();
        let mut open: Option<f64> = None;
        let mut along = 0.0;
        while along <= total + step {
            let t = along.min(total);
            let wet = at(points, t).is_some_and(|(p, _)| self.is_water(p));
            match (wet, open) {
                (true, None) => open = Some(t),
                (false, Some(start)) => {
                    runs.push((start, t));
                    open = None;
                }
                _ => {}
            }
            along += step;
        }
        if let Some(start) = open {
            runs.push((start, total));
        }
        runs
    }
    /// How far a line runs before it meets ground whose owner `stops` it.
    pub fn reach(&self, points: &[Point], stops: impl Fn(u32) -> bool) -> f64 {
        let step = self.cell / 2.0;
        let total = line_length(points);
        let mut along = 0.0;
        while along <= total {
            if at(points, along).is_some_and(|(p, _)| stops(self.owner(p))) {
                return along;
            }
            along += step;
        }
        total
    }
}
/// Whether a point is nearer than `range` to any listed point.
pub fn near_any(p: Point, points: &[Point], range: f64) -> bool {
    points.iter().any(|q| distance(p, *q) < range)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atlas::town::geometry::rectangle;
    #[test]
    fn rectangles_take_ground_once_and_respect_their_own_street() {
        let mut ground = Ground::new([0.0, 0.0, 100.0, 100.0], 2.0);
        let street = FIRST_STREET;
        ground.take_line(&[[0.0, 50.0], [100.0, 50.0]], 6.0, street);
        assert_eq!(ground.owner([40.0, 51.0]), street);
        let plot = rectangle([20.0, 53.0], [1.0, 0.0], [0.0, 1.0], 8.0, 20.0);
        assert!(ground.open(&Rectangle(&plot), street));
        assert!(!ground.open(&Rectangle(&plot), street + 1));
        ground.take(&Rectangle(&plot), street);
        let crossing = rectangle([22.0, 60.0], [0.0, 1.0], [1.0, 0.0], 8.0, 20.0);
        assert!(!ground.open(&Rectangle(&crossing), street + 1));
        let beyond = rectangle([60.0, 55.0], [1.0, 0.0], [0.0, 1.0], 8.0, 20.0);
        assert!(ground.open(&Rectangle(&beyond), street + 1));
        assert_eq!(ground.owner([-1.0, 5.0]), OUTSIDE);
    }
    #[test]
    fn water_runs_and_reach_are_measured_along_a_line() {
        let mut ground = Ground::new([0.0, 0.0, 100.0, 20.0], 1.0);
        for i in 0..ground.count() {
            let [x, _] = ground.centre(i);
            if (40.0..50.0).contains(&x) {
                ground.withhold(i, WATER);
            }
        }
        let line = [[0.0, 10.0], [100.0, 10.0]];
        let runs = ground.wet_runs(&line);
        assert_eq!(runs.len(), 1);
        assert!((runs[0].0 - 40.0).abs() <= 1.0 && (runs[0].1 - 50.0).abs() <= 1.0);
        let reach = ground.reach(&line, |owner| owner == WATER);
        assert!((reach - 40.0).abs() <= 1.0);
        assert!(near_any([0.0, 0.0], &[[3.0, 4.0]], 5.1));
    }
}
