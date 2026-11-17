use crate::{
    lattice::TriangularLattice,
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};

/// Share of the parent's cell span a carried river wanders off the parent's straight legs.
const WANDER: f64 = 0.08;
const WANDER_OCTAVES: usize = 4;
/// Where parent positions lie on a child map. The parent drew its rivers as straight legs
/// between its own cells; the child bends every carried position by one smooth fractal
/// displacement scaled to the parent's span, so carried courses wander and stay joined. The
/// displacement is measured from the child's centre, which stays where the creator opened
/// the map. A zero span leaves positions where they are.
#[derive(Clone, Copy)]
pub(crate) struct Bend {
    span: f64,
    anchor: [f64; 2],
}
impl Bend {
    /// The bend a child on `mesh` gives positions from a parent of cell span `span`.
    pub fn new(span: f64, mesh: &TriangularLattice) -> Self {
        let atlas_map::Bounds(w, s, e, n) = mesh.bounds();
        let [x, y] = mesh.origin();
        Self::around(span, [x + (w + e) / 2.0, y + (s + n) / 2.0])
    }
    /// The bend that leaves `centre` where it is.
    fn around(span: f64, centre: [f64; 2]) -> Self {
        let mut bend = Self {
            span,
            anchor: [0.0, 0.0],
        };
        bend.anchor = bend.offset(centre);
        bend
    }
    fn offset(&self, point: [f64; 2]) -> [f64; 2] {
        let wander = |salt| {
            WANDER
                * self.span
                * crate::noise::fractal_noise(point[0], point[1], salt, self.span, WANDER_OCTAVES)
        };
        [wander(0x5c01), wander(0x5c02)]
    }
    pub fn at(&self, point: [f64; 2]) -> [f64; 2] {
        if self.span <= 0.0 {
            return point;
        }
        let [dx, dy] = self.offset(point);
        [
            point[0] + dx - self.anchor[0],
            point[1] + dy - self.anchor[1],
        ]
    }
    /// A parent shape as the child sees it: every line and ring densified and every position
    /// bent, so captured places, ways, waters and outlines move with the rivers.
    pub fn geometry(&self, geometry: &Geometry) -> Geometry {
        bent_geometry(geometry, self)
    }
    /// The child triangle a parent position lands on: bent, then looked up inside the map's own
    /// triangles. A position that bends outside the frame lands on none. The river network,
    /// captured courses, captured records and carried places all locate through this.
    pub fn cell(&self, mesh: &TriangularLattice, parent: [f64; 2]) -> Option<usize> {
        content_cell(mesh, self.at(parent))
    }
}
/// The lattice cell the carried river network takes for a position already bent onto this
/// map; the network keeps only positions inside its frame mask.
pub(crate) fn network_cell(mesh: &TriangularLattice, [x, y]: [f64; 2]) -> Option<usize> {
    let [ox, oy] = mesh.origin();
    mesh.cell_at(x - ox, y - oy)
}
/// The map's own triangle under a position already on this map, or none outside its frame.
pub(crate) fn content_cell(mesh: &TriangularLattice, [x, y]: [f64; 2]) -> Option<usize> {
    let [ox, oy] = mesh.origin();
    mesh.cell_at(mesh.delta_x(x - ox), y - oy)
        .filter(|&cell| mesh.membership(cell) == crate::lattice::Membership::Content)
}
/// Legs of a carried line are cut this many times finer than the parent's span before they
/// bend, so a straight parent leg wanders along its length and not only at its ends.
const BEND_STEPS_PER_SPAN: f64 = 32.0;
fn bent_geometry(geometry: &Geometry, bend: &Bend) -> Geometry {
    let span = bend.span;
    let point = |p: &Position| match *p {
        Position::XY(xy) => Position::XY(bend.at(xy)),
        Position::XYZ([x, y, z]) => {
            let [x, y] = bend.at([x, y]);
            Position::XYZ([x, y, z])
        }
    };
    let between = |a: &Position, b: &Position, t: f64| match (*a, *b) {
        (Position::XYZ(a), Position::XYZ(b)) => {
            Position::XYZ([0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * t))
        }
        _ => {
            let ([ax, ay, _], [bx, by, _]) = (a.coordinates(), b.coordinates());
            Position::xy(ax + (bx - ax) * t, ay + (by - ay) * t)
        }
    };
    let line = |line: &[Position]| {
        let step = span / BEND_STEPS_PER_SPAN;
        let mut out = Vec::with_capacity(line.len());
        for pair in line.windows(2) {
            let ([ax, ay, _], [bx, by, _]) = (pair[0].coordinates(), pair[1].coordinates());
            let parts = ((bx - ax).hypot(by - ay) / step).ceil().max(1.0) as usize;
            for k in 0..parts {
                out.push(point(&between(&pair[0], &pair[1], k as f64 / parts as f64)));
            }
        }
        out.extend(line.last().map(point));
        out
    };
    let rings = |rings: &[Vec<Position>]| rings.iter().map(|r| line(r)).collect::<Vec<_>>();
    if span <= 0.0 {
        return geometry.clone();
    }
    match geometry {
        Geometry::Point { coordinates } => Geometry::Point {
            coordinates: point(coordinates),
        },
        Geometry::MultiPoint { coordinates } => Geometry::MultiPoint {
            coordinates: coordinates.iter().map(point).collect(),
        },
        Geometry::LineString { coordinates } => Geometry::LineString {
            coordinates: line(coordinates),
        },
        Geometry::MultiLineString { coordinates } => Geometry::MultiLineString {
            coordinates: rings(coordinates),
        },
        Geometry::Polygon { coordinates } => Geometry::Polygon {
            coordinates: rings(coordinates),
        },
        Geometry::MultiPolygon { coordinates } => Geometry::MultiPolygon {
            coordinates: coordinates.iter().map(|p| rings(p)).collect(),
        },
        Geometry::GeometryCollection { geometries } => Geometry::GeometryCollection {
            geometries: geometries.iter().map(|g| bent_geometry(g, bend)).collect(),
        },
    }
}
pub(super) struct ImportGeometry<'a> {
    pub mesh: &'a TriangularLattice,
    pub spatial: &'a dyn SpatialKernel,
    pub mask: Geometry,
    /// How carried positions bend onto this map.
    pub bend: Bend,
}
impl<'a> ImportGeometry<'a> {
    /// `span` is the parent's cell span; zero on a map with no parent.
    pub fn new(mesh: &'a TriangularLattice, spatial: &'a dyn SpatialKernel, span: f64) -> Self {
        let bend = Bend::new(span, mesh);
        let b = mesh.bounds();
        let [x, y] = mesh.origin();
        let mask = Geometry::Polygon {
            coordinates: vec![vec![
                Position::xy(b.0 + x, b.1 + y),
                Position::xy(b.2 + x, b.1 + y),
                Position::xy(b.2 + x, b.3 + y),
                Position::xy(b.0 + x, b.3 + y),
                Position::xy(b.0 + x, b.1 + y),
            ]],
        };
        Self {
            mesh,
            spatial,
            mask,
            bend,
        }
    }
    /// A parent point's cell: bent first, then kept only when it lands inside the frame.
    pub fn point_cell(&self, position: Position) -> SpatialResult<Option<usize>> {
        let bent = self.bent(position);
        if !self.spatial.covers_points(&self.mask, &[bent])?[0] {
            return Ok(None);
        }
        Ok(self.at(bent))
    }
    /// The cell a parent position bends onto.
    pub fn cell(&self, position: Position) -> Option<usize> {
        self.at(self.bent(position))
    }
    fn bent(&self, position: Position) -> Position {
        let [x, y, _] = position.coordinates();
        let [x, y] = self.bend.at([x, y]);
        Position::xy(x, y)
    }
    /// The cell under a position already bent onto this map.
    fn at(&self, bent: Position) -> Option<usize> {
        let [x, y, _] = bent.coordinates();
        network_cell(self.mesh, [x, y])
    }
    /// A parent course with each vertex bent and no vertex added, so per-vertex profiles still
    /// line up with it.
    pub fn bent_course(&self, course: &[Position]) -> Vec<Position> {
        course.iter().map(|p| self.bent(*p)).collect()
    }
    pub fn position(&self, cell: usize) -> Position {
        let [x, y] = self.mesh.position(cell);
        let [ox, oy] = self.mesh.origin();
        Position::xy(x + ox, y + oy)
    }
    /// A parent course as this map holds it: bent first, then clipped to the frame, so a river
    /// that bends into the map is kept and one that bends out of it is cut where it leaves.
    pub fn clipped(&self, course: &[Position]) -> SpatialResult<Vec<Vec<Position>>> {
        if course.len() < 2 {
            return Ok(Vec::new());
        }
        let bent = self.bend.geometry(&Geometry::LineString {
            coordinates: course.to_vec(),
        });
        let result = self.spatial.clip_trace(&bent, &self.mask)?;
        let mut lines = Vec::new();
        if let Some(result) = result {
            line_parts(result, &mut lines);
        }
        Ok(lines)
    }
    /// The cells along a line already bent and clipped onto this map (`clipped`).
    pub fn sampled(&self, line: &[Position]) -> SpatialResult<Vec<Option<usize>>> {
        let sampled = self.spatial.resample_trace(
            &Geometry::LineString {
                coordinates: line.to_vec(),
            },
            0.0,
            // Finer than a cell, so a bent line still steps between neighbouring cells.
            Some(self.mesh.spacing() / 6.0),
        )?;
        match sampled {
            Geometry::LineString { coordinates } => {
                Ok(coordinates.iter().map(|p| self.at(*p)).collect())
            }
            _ => Err("River resampling must return a directed line".into()),
        }
    }
}
fn line_parts(shape: Geometry, output: &mut Vec<Vec<Position>>) {
    match shape {
        Geometry::LineString { coordinates } => output.push(coordinates),
        Geometry::MultiLineString { coordinates } => output.extend(coordinates),
        Geometry::GeometryCollection { geometries } => {
            for shape in geometries {
                line_parts(shape, output);
            }
        }
        // An isolated clipping contact is not a directed river course.
        _ => {}
    }
}
/// Linear interpolation of numerical profiles after GEOS has located every target station.
pub(crate) struct Stations {
    edges: Vec<(usize, f64)>,
    vertices: usize,
}
impl Stations {
    pub fn new(
        spatial: &dyn SpatialKernel,
        source: &[Position],
        target: &[Position],
    ) -> SpatialResult<Self> {
        let mut distances = vec![0.0; source.len()];
        for (at, edge) in source.windows(2).enumerate() {
            let a = edge[0].coordinates();
            let b = edge[1].coordinates();
            distances[at + 1] = distances[at] + (b[0] - a[0]).hypot(b[1] - a[1]);
        }
        let length = distances.last().copied().unwrap_or(0.0);
        if length <= 0.0 {
            return Err("A directed river needs nonzero segments".into());
        }
        let fractions = spatial.line_fractions(
            &Geometry::LineString {
                coordinates: source.to_vec(),
            },
            target,
        )?;
        let edges = fractions
            .into_iter()
            .map(|fraction| {
                let distance = fraction * length;
                let at = distances
                    .partition_point(|d| *d < distance)
                    .max(1)
                    .min(source.len() - 1)
                    - 1;
                let span = distances[at + 1] - distances[at];
                (
                    at,
                    if span > 0.0 {
                        (distance - distances[at]) / span
                    } else {
                        0.0
                    },
                )
            })
            .collect();
        Ok(Self {
            edges,
            vertices: source.len(),
        })
    }
    pub fn interpolate(&self, values: &[f64]) -> SpatialResult<Vec<f64>> {
        if values.len() != self.vertices || !values.iter().all(|v| v.is_finite()) {
            return Err("River profile needs one finite value per source vertex".into());
        }
        Ok(self
            .edges
            .iter()
            .map(|&(at, fraction)| values[at] + (values[at + 1] - values[at]) * fraction)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::Bend;
    use atlas_map::{Geometry, Position};
    #[test]
    fn a_bend_keeps_the_maps_centre_and_moves_nearby_positions_a_little_and_smoothly() {
        let span = 14_000.0;
        let centre = [666_667.0, 130_736.0];
        let bend = Bend::around(span, centre);
        let kept = bend.at(centre);
        assert!((kept[0] - centre[0]).abs() < 1e-6 && (kept[1] - centre[1]).abs() < 1e-6);
        let moved = |p: [f64; 2]| {
            let q = bend.at(p);
            (q[0] - p[0]).hypot(q[1] - p[1])
        };
        let far = [centre[0] + 5_000.0, centre[1] - 3_000.0];
        assert!(moved(far) > 1.0 && moved(far) < 0.2 * span);
        let next = [far[0] + 10.0, far[1]];
        assert!((moved(next) - moved(far)).abs() < 5.0);
    }
    #[test]
    fn a_straight_parent_leg_bends_along_its_length() {
        let bend = Bend::around(14_000.0, [0.0, 0.0]);
        let leg = Geometry::LineString {
            coordinates: vec![Position::xy(-7_000.0, 0.0), Position::xy(7_000.0, 0.0)],
        };
        let Geometry::LineString { coordinates } = bend.geometry(&leg) else {
            panic!("a line stays a line");
        };
        assert!(coordinates.len() > 30);
        let off = coordinates
            .iter()
            .map(|p| p.coordinates()[1].abs())
            .fold(0.0, f64::max);
        assert!(off > 50.0, "the leg stayed straight: {off} m");
    }
}
