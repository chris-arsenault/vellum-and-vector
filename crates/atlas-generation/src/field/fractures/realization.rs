use super::{growth::widen_values, Fault, Field};
use crate::{
    field::shared::Scalar,
    rock::ground::{
        queries::{surface_response, SurfaceResponse},
        GroundField,
    },
    spatial::SpatialKernel,
};
use atlas_map::{Geometry, Position};
use std::io;
fn lines(value: Geometry) -> Vec<Vec<Position>> {
    match value {
        Geometry::LineString { coordinates } => vec![coordinates],
        Geometry::MultiLineString { coordinates } => coordinates,
        Geometry::GeometryCollection { geometries } => {
            geometries.into_iter().flat_map(lines).collect()
        }
        _ => Vec::new(),
    }
}
fn opening(field: &Field, cell: usize) -> io::Result<f64> {
    let held = field.shared.scalar(Scalar::FractureConductance).get(cell)?;
    let strain = field.shared.scalar(Scalar::TectonicStrain).get(cell)? / 1000.0;
    let joints = field
        .ground()
        .fold(cell, &surface_response(SurfaceResponse::Openness), None)?;
    Ok(held + (1000.0 - held) * strain * joints)
}
impl Field {
    pub fn realize_captured_faults(
        &mut self,
        faults: &[Fault],
        contact_width: f64,
        kernel: &dyn SpatialKernel,
    ) -> io::Result<()> {
        for fault in faults {
            let geometry = Geometry::LineString {
                coordinates: fault
                    .coordinates
                    .iter()
                    .map(|p| Position::xy(p[0], p[1]))
                    .collect(),
            };
            let Some(clipped) = kernel
                .clip_by_rect(&geometry, self.mesh.bounds())
                .map_err(io::Error::other)?
            else {
                continue;
            };
            for (part, coordinates) in lines(clipped).into_iter().enumerate() {
                let trace = kernel
                    .resample_trace(
                        &Geometry::LineString {
                            coordinates: coordinates.clone(),
                        },
                        0.0,
                        Some(self.mesh.spacing() / 3.0),
                    )
                    .map_err(io::Error::other)?;
                let Geometry::LineString { coordinates: trace } = trace else {
                    return Err(io::Error::other("Resampled fault must remain a line"));
                };
                let mut readings = Vec::with_capacity(trace.len());
                for point in &trace {
                    let [x, y, _] = point.coordinates();
                    // Resampling snaps clipped endpoints to geometry precision, which may
                    // place an edge sample just beyond the frame. Read its boundary support.
                    let cell = self
                        .mesh
                        .cell_at(x, y)
                        .or_else(|| self.mesh.edge_cell(x, y))
                        .ok_or_else(|| {
                            io::Error::other("Captured fault sample lies outside lattice")
                        })?;
                    readings.push(opening(self, cell)?);
                }
                let mut conductance = self.shared.derive_scalar(Scalar::FractureConductance);
                for (point, value) in trace.iter().zip(readings) {
                    let [x, y, _] = point.coordinates();
                    widen_values(&self.mesh, &mut conductance, [x, y], fault.width, value)?;
                }
                self.faults.push(Fault {
                    id: if part == 0 {
                        fault.id.clone()
                    } else {
                        format!("{}:part:{part}", fault.id)
                    },
                    width: fault.width,
                    coordinates: coordinates
                        .iter()
                        .map(|p| {
                            let [x, y, _] = p.coordinates();
                            [x, y]
                        })
                        .collect(),
                });
            }
        }
        if contact_width > 0.0 {
            self.realize_sheet_contacts(contact_width)?;
        }
        Ok(())
    }
    pub fn realize_sheet_contacts(&self, width: f64) -> io::Result<()> {
        let strength = (0..self.mesh.len())
            .map(|cell| opening(self, cell))
            .collect::<io::Result<Vec<_>>>()?;
        let ground = self.ground();
        let pairs = ground.view(GroundField::ThrustPairIds);
        let sheets = ground.view(GroundField::ThrustSheetIndex);
        let segments = ground.view(GroundField::ThrustSegmentIds);
        let mut conductance = self.shared.derive_scalar(Scalar::FractureConductance);
        for cell in 0..self.mesh.len() {
            let pair = pairs.get(cell)?;
            if pair <= 0.0 {
                continue;
            }
            for edge in 0..3 {
                let Some(next) = self.mesh.neighbor(cell, edge) else {
                    continue;
                };
                if next < cell
                    || pairs.get(next)? != pair
                    || (sheets.get(next)? == sheets.get(cell)?
                        && segments.get(next)? == segments.get(cell)?)
                {
                    continue;
                }
                if let Some((point, _, _)) = self.mesh.physical_face(cell, edge) {
                    widen_values(
                        &self.mesh,
                        &mut conductance,
                        point,
                        width,
                        (strength[cell] + strength[next]) / 2.0,
                    )?;
                }
            }
        }
        Ok(())
    }
}
