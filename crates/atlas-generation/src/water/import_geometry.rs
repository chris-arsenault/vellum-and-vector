use crate::{
    lattice::TriangularLattice,
    spatial::{SpatialKernel, SpatialResult},
};
use atlas_map::{Geometry, Position};

pub(super) struct ImportGeometry<'a> {
    pub mesh: &'a TriangularLattice,
    pub spatial: &'a dyn SpatialKernel,
    pub mask: Geometry,
}
impl<'a> ImportGeometry<'a> {
    pub fn new(mesh: &'a TriangularLattice, spatial: &'a dyn SpatialKernel) -> Self {
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
        }
    }
    pub fn cell(&self, position: Position) -> Option<usize> {
        let [x, y, _] = position.coordinates();
        let [ox, oy] = self.mesh.origin();
        self.mesh.cell_at(x - ox, y - oy)
    }
    pub fn position(&self, cell: usize) -> Position {
        let [x, y] = self.mesh.position(cell);
        let [ox, oy] = self.mesh.origin();
        Position::xy(x + ox, y + oy)
    }
    pub fn clipped(&self, course: &[Position]) -> SpatialResult<Vec<Vec<Position>>> {
        if course.len() < 2 {
            return Ok(Vec::new());
        }
        let result = self.spatial.clip_trace(
            &Geometry::LineString {
                coordinates: course.to_vec(),
            },
            &self.mask,
        )?;
        let mut lines = Vec::new();
        if let Some(result) = result {
            line_parts(result, &mut lines);
        }
        Ok(lines)
    }
    pub fn sampled(&self, line: &[Position]) -> SpatialResult<Vec<Option<usize>>> {
        let sampled = self.spatial.resample_trace(
            &Geometry::LineString {
                coordinates: line.to_vec(),
            },
            0.0,
            Some(self.mesh.spacing() / 3.0),
        )?;
        match sampled {
            Geometry::LineString { coordinates } => {
                Ok(coordinates.iter().map(|p| self.cell(*p)).collect())
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
