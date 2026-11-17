use crate::features::{Feature, FeatureReader, FeatureSelection};
use crate::{hpc::BitSet, lattice::TriangularLattice, water::reaches::ReachStore};
use atlas_map::{Geometry, Position};
use serde::{Deserialize, Serialize};
// hpc-exempt: removed feature identities in the private catalog.
use std::{collections::BTreeSet, io};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarriedCourse {
    pub source_id: String,
    pub geometry: Geometry,
    pub discharge: f64,
    pub order: f64,
}
#[derive(Serialize, Deserialize)]
pub struct CapturedCourse {
    pub feature: Feature,
    pub cells: Vec<usize>,
    pub discharge: f64,
    pub order: f64,
    pub carried: Option<CarriedCourse>,
}
pub fn captured_courses(
    mesh: &TriangularLattice,
    source: &dyn FeatureReader,
    area: &str,
    // hpc-exempt: removed feature identities, not a numerical cell mask.
    removed: &BTreeSet<String>,
    span: f64,
    bend: f64,
) -> io::Result<Vec<CapturedCourse>> {
    let mut rivers = source
        .values(FeatureSelection {
            area_id: Some(area),
            kind: Some("river"),
            ..Default::default()
        })?
        .collect::<io::Result<Vec<_>>>()?;
    // hpc-exempt: order sparse named feature identities, not cell storage.
    rivers.sort_by(|a, b| a.id.cmp(&b.id));
    let mut courses = Vec::new();
    for feature in rivers {
        if removed.contains(&feature.id) {
            continue;
        }
        let cells = course_cells(mesh, &feature.geometry, span, bend);
        if cells.is_empty() {
            continue;
        }
        let number = |key, default| {
            feature
                .attributes
                .get(key)
                .filter(|v| !v.is_null())
                .map_or(Ok(default), |v| {
                    v.as_f64()
                        .or_else(|| v.as_str().and_then(|v| v.parse().ok()))
                        .ok_or_else(|| {
                            io::Error::new(
                                io::ErrorKind::InvalidData,
                                format!("River {key} must be numeric"),
                            )
                        })
                })
        };
        courses.push(CapturedCourse {
            cells,
            discharge: number("discharge", 0.0)?,
            order: number("order", 1.0)?,
            carried: feature
                .attributes
                .get("capturedCourse")
                .filter(|v| !v.is_null())
                .map(|v| serde_json::from_value(v.clone()).map_err(io::Error::other))
                .transpose()?,
            feature,
        });
    }
    Ok(courses)
}
pub fn line_parts(geometry: &Geometry) -> Vec<&[Position]> {
    match geometry {
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::MultiLineString { coordinates } => {
            coordinates.iter().map(Vec::as_slice).collect()
        }
        _ => Vec::new(),
    }
}
pub fn cell_at(mesh: &TriangularLattice, world: [f64; 2]) -> Option<usize> {
    let origin = mesh.origin();
    mesh.cell_at(mesh.delta_x(world[0] - origin[0]), world[1] - origin[1])
}
/// The cells a carried course crosses, its positions bent as the carried river network is
/// (`water::import_geometry::Bend`) by the parent's cell span `bend`. A stretch that bends
/// outside the frame is clipped away, as the network clips it, never held at the edge.
pub fn course_cells(
    mesh: &TriangularLattice,
    geometry: &Geometry,
    span: f64,
    bend: f64,
) -> Vec<usize> {
    let step = span / 4.0;
    let bend = crate::water::import_geometry::Bend::new(bend, mesh);
    let mut seen = BitSet::new(mesh.len());
    let mut cells = Vec::new();
    for line in line_parts(geometry) {
        for pair in line.windows(2) {
            let [ax, ay, _] = pair[0].coordinates();
            let [bx, by, _] = pair[1].coordinates();
            let steps = ((bx - ax).hypot(by - ay) / step).ceil().max(1.0) as usize;
            for s in 0..=steps {
                let t = s as f64 / steps as f64;
                let point = [ax + (bx - ax) * t, ay + (by - ay) * t];
                if let Some(cell) = bend.cell(mesh, point).filter(|&cell| seen.add(cell)) {
                    cells.push(cell);
                }
            }
        }
    }
    cells
}
pub fn retained_cells(count: usize, store: &ReachStore) -> Vec<usize> {
    let mut seen = BitSet::new(count);
    let mut cells = Vec::new();
    for reach in store.reaches() {
        for &cell in reach
            .cells()
            .iter()
            .chain(reach.former().iter().flat_map(|course| &course.cells))
        {
            if seen.add(cell) {
                cells.push(cell);
            }
        }
    }
    cells
}
