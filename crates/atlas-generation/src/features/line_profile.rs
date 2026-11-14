//! Located per-vertex line values; nearest segments and linear referencing use the spatial adapter.
use super::{network_parts::line_parts, records::Attributes};
use crate::spatial::{SpatialIndex, SpatialKernel};
use atlas_map::{Bounds, Geometry, Position};
use std::io;

pub struct Location {
    pub offset: usize,
    pub fraction: f64,
    pub tangent: [f64; 2],
    distance: f64,
    height: f64,
}
pub struct Line<'a> {
    segments: Vec<Geometry>,
    offsets: Vec<usize>,
    count: usize,
    index: Box<dyn SpatialIndex + 'a>,
    spatial: &'a dyn SpatialKernel,
}
impl<'a> Line<'a> {
    pub fn new(geometry: &Geometry, spatial: &'a dyn SpatialKernel) -> io::Result<Self> {
        let mut segments = Vec::new();
        let mut offsets = Vec::new();
        let mut count = 0;
        for part in line_parts(geometry) {
            for (offset, pair) in part.windows(2).enumerate() {
                let [x, y, _] = pair[0].coordinates();
                let [ex, ey, _] = pair[1].coordinates();
                if x != ex || y != ey {
                    segments.push(Geometry::LineString {
                        coordinates: pair.to_vec(),
                    });
                    offsets.push(count + offset);
                }
            }
            count += part.len();
        }
        if segments.is_empty() {
            return Err(io::Error::other("A directed line needs nonzero segments"));
        }
        let index = spatial.index(&segments).map_err(io::Error::other)?;
        Ok(Self {
            segments,
            offsets,
            count,
            index,
            spatial,
        })
    }
    fn segment(&self, index: usize, point: Position) -> io::Result<Location> {
        let geometry = &self.segments[index];
        let Geometry::LineString { coordinates } = geometry else {
            unreachable!()
        };
        let fraction = self
            .spatial
            .line_fraction(geometry, point)
            .map_err(io::Error::other)?;
        let [ax, ay, az] = coordinates[0].coordinates();
        let [bx, by, bz] = coordinates[1].coordinates();
        let length = (bx - ax).hypot(by - ay);
        let [px, py, _] = point.coordinates();
        Ok(Location {
            offset: self.offsets[index],
            fraction,
            tangent: [(bx - ax) / length, (by - ay) / length],
            distance: (px - ax - fraction * (bx - ax)).hypot(py - ay - fraction * (by - ay)),
            height: az + fraction * (bz - az),
        })
    }
    pub fn locate(&self, point: Position) -> io::Result<Location> {
        let first = self
            .index
            .nearest(point)
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("A directed line needs nonzero segments"))?;
        let mut selected = self.segment(first, point)?;
        let [x, y, z] = point.coordinates();
        let radius = selected.distance;
        // A spatial range query preserves the vertical tie rule at coincident projected courses.
        for index in self
            .index
            .query(Bounds(x - radius, y - radius, x + radius, y + radius))
            .map_err(io::Error::other)?
        {
            let candidate = self.segment(index, point)?;
            let nearer = candidate.distance < selected.distance;
            let tie = candidate.distance == selected.distance;
            if nearer
                || (tie
                    && ((candidate.height - z).abs() < (selected.height - z).abs()
                        || ((candidate.height - z).abs() == (selected.height - z).abs()
                            && candidate.offset < selected.offset)))
            {
                selected = candidate;
            }
        }
        Ok(selected)
    }
    pub fn value(
        &self,
        attributes: &Attributes,
        name: &str,
        point: Position,
    ) -> io::Result<Option<f64>> {
        let Some(values) = attributes.get(name).and_then(|value| value.as_array()) else {
            return Ok(None);
        };
        if values.len() != self.count
            || values
                .iter()
                .any(|value| value.as_f64().is_none_or(|v| !v.is_finite()))
        {
            return Err(io::Error::other(format!(
                "Channel {name} needs one finite value per line vertex"
            )));
        }
        let at = self.locate(point)?;
        let a = values[at.offset].as_f64().expect("validated value");
        let b = values[at.offset + 1].as_f64().expect("validated value");
        Ok(Some(a + (b - a) * at.fraction))
    }
    pub fn direction(
        &self,
        footprint: &Geometry,
        point: Position,
        precision: f64,
    ) -> io::Result<&'static str> {
        let at = self.locate(point)?;
        let [x, y, _] = point.coordinates();
        let [dx, dy] = at.tangent.map(|v| v * precision * 4.0);
        let covered = self
            .spatial
            .covers_points(
                footprint,
                &[Position::xy(x - dx, y - dy), Position::xy(x + dx, y + dy)],
            )
            .map_err(io::Error::other)?;
        Ok(if covered[0] == covered[1] {
            "undirected"
        } else if covered[1] {
            "incoming"
        } else {
            "outgoing"
        })
    }
}
