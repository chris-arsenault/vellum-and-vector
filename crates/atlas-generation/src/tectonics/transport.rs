use super::{
    motion,
    state::{Plate, Site, State},
};
use crate::{
    field::shared::{CellCode, Scalar, SharedFields},
    lattice::TriangularLattice,
};
use std::io;

pub enum SourceMotion<'a> {
    Mechanical {
        site: &'a Site,
        plate: &'a Plate,
        distance: f64,
    },
    Translation([f64; 2]),
}
impl SourceMotion<'_> {
    pub fn move_point(&self, mesh: &TriangularLattice, position: [f64; 2]) -> [f64; 2] {
        match self {
            Self::Mechanical {
                site,
                plate,
                distance,
            } => motion::move_point(mesh, site, plate, position, *distance),
            Self::Translation([dx, dy]) => [position[0] + dx, position[1] + dy],
        }
    }
    pub fn deformation(&self) -> [f64; 4] {
        match self {
            Self::Translation(_) => [1.0, 0.0, 0.0, 1.0],
            Self::Mechanical {
                site,
                plate,
                distance,
            } => {
                let angle = plate.spin * distance;
                let a = angle.cos();
                let b = angle.sin() - site.compliance * angle;
                [a, -b, b, a]
            }
        }
    }
}
pub fn source_motion<'a>(
    state: Option<&'a State>,
    fields: &SharedFields,
    cell: usize,
    distance: f64,
) -> io::Result<SourceMotion<'a>> {
    let id = fields.code(CellCode::CrustProvinceIds).get(cell)?;
    if let Some(state) = state {
        if let Some(site) = usize::try_from(id)
            .ok()
            .and_then(|i| i.checked_sub(1))
            .and_then(|i| state.sites.get(i))
        {
            if let Some(plate) = state.plates.iter().find(|p| p.id == site.plate) {
                return Ok(SourceMotion::Mechanical {
                    site,
                    plate,
                    distance,
                });
            }
        }
    }
    Ok(SourceMotion::Translation([
        fields.scalar(Scalar::CrustMotionX).get(cell)? * distance / 1000.0,
        fields.scalar(Scalar::CrustMotionY).get(cell)? * distance / 1000.0,
    ]))
}
