//! Landmark stations and GEOS-indexed path positions, including longitude images.
use crate::{
    field::Field,
    hpc::group_by_label,
    lattice::{TriangularLattice, BLOCK_CELLS},
    spatial::SpatialKernel,
    storage::Band,
};
use atlas_map::{Geometry, Position};
use std::io;
struct Segment {
    start: [f64; 2],
    delta: [f64; 2],
    length: f64,
    from: f64,
}
pub struct Path {
    segments: Vec<Segment>,
    pub total: f64,
}
pub struct Station {
    pub point: [f64; 2],
    pub normal: [f64; 2],
    pub along: f64,
}
pub struct Hits {
    pub distance: Band<f64>,
    pub along: Band<f64>,
    pub side: Band<f64>,
}
impl Path {
    pub fn new(mesh: &TriangularLattice, points: &[[f64; 2]]) -> Self {
        let mut segments = Vec::new();
        let mut total = 0.0;
        for pair in points.windows(2) {
            let delta = [
                mesh.delta_x(pair[1][0] - pair[0][0]),
                pair[1][1] - pair[0][1],
            ];
            let length = delta[0].hypot(delta[1]);
            if length == 0.0 {
                continue;
            }
            segments.push(Segment {
                start: pair[0],
                delta,
                length,
                from: total,
            });
            total += length;
        }
        Self { segments, total }
    }
    pub fn stations(&self, step: f64) -> io::Result<Vec<Station>> {
        if !step.is_finite() || step <= 0.0 {
            return Err(io::Error::other(
                "Path station spacing must be finite and positive",
            ));
        }
        let mut result = Vec::new();
        for s in &self.segments {
            let normal = [-s.delta[1] / s.length, s.delta[0] / s.length];
            let mut a = 0.0;
            while a < s.length {
                result.push(Station {
                    point: [
                        s.start[0] + a / s.length * s.delta[0],
                        s.start[1] + a / s.length * s.delta[1],
                    ],
                    normal,
                    along: s.from + a,
                });
                a += step;
            }
        }
        if let Some(s) = self.segments.last() {
            result.push(Station {
                point: [s.start[0] + s.delta[0], s.start[1] + s.delta[1]],
                normal: [-s.delta[1] / s.length, s.delta[0] / s.length],
                along: self.total,
            });
        }
        Ok(result)
    }
    pub fn hits(&self, field: &Field, kernel: &dyn SpatialKernel) -> io::Result<Hits> {
        let mut coverage = field.coverage.try_borrow_mut().map_err(io::Error::other)?;
        let mut hits = Hits {
            distance: coverage.allocate(f64::INFINITY),
            along: coverage.allocate(0.0),
            side: coverage.allocate(1.0),
        };
        if self.segments.is_empty() {
            return Ok(hits);
        }
        let width = field.mesh.coordinate_width().unwrap_or(0.0);
        let shifts: &[f64] = if width == 0.0 {
            &[0.0]
        } else {
            &[-width, 0.0, width]
        };
        let mut geometry = Vec::new();
        for s in &self.segments {
            for &shift in shifts {
                geometry.push(Geometry::LineString {
                    coordinates: vec![
                        Position::xy(s.start[0] + shift, s.start[1]),
                        Position::xy(s.start[0] + shift + s.delta[0], s.start[1] + s.delta[1]),
                    ],
                });
            }
        }
        let index = kernel.index(&geometry).map_err(io::Error::other)?;
        for start in (0..field.mesh.len()).step_by(BLOCK_CELLS) {
            let points: Vec<_> = (start..(start + BLOCK_CELLS).min(field.mesh.len()))
                .map(|cell| {
                    let [x, y] = field.mesh.position(cell);
                    Position::xy(x, y)
                })
                .collect();
            let labels = index
                .nearest_many(&points)
                .map_err(io::Error::other)?
                .into_iter()
                .map(|label| {
                    label.map_or(Ok(-1), |label| {
                        i32::try_from(label).map_err(io::Error::other)
                    })
                })
                .collect::<io::Result<Vec<_>>>()?;
            let groups = group_by_label(&labels, geometry.len());
            for (at, line) in geometry.iter().enumerate() {
                let members = groups.members_of(at);
                if members.is_empty() {
                    continue;
                }
                let selected: Vec<_> = members.iter().map(|&i| points[i]).collect();
                let fractions = kernel
                    .line_fractions(line, &selected)
                    .map_err(io::Error::other)?;
                let s = &self.segments[at / shifts.len()];
                let shift = shifts[at % shifts.len()];
                for (&member, t) in members.iter().zip(fractions) {
                    let [x, y, _] = points[member].coordinates();
                    let dx = x - s.start[0] - shift;
                    let dy = y - s.start[1];
                    hits.distance.set(
                        start + member,
                        (dx - t * s.delta[0]).hypot(dy - t * s.delta[1]),
                    )?;
                    hits.along.set(start + member, s.from + t * s.length)?;
                    hits.side.set(
                        start + member,
                        if s.delta[0] * dy - s.delta[1] * dx >= 0.0 {
                            1.0
                        } else {
                            -1.0
                        },
                    )?;
                }
            }
        }
        Ok(hits)
    }
}
