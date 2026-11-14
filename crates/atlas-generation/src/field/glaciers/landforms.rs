use super::Settings;
use crate::{
    field::{
        shared::{CellCode as C, Scalar as S},
        Field,
    },
    lattice::sampling::Sampler,
    rock::ground::GroundField,
    scale::MapScale,
};
use std::io;
fn cirque(field: &Field, sampler: &mut Sampler<'_>, cell: usize, p: &Settings) -> io::Result<bool> {
    let ice = field.shared.scalar(S::MaximumIceThickness);
    let thickness = ice.get(cell)?;
    if thickness < p.glacier_thickness_threshold {
        return Ok(false);
    }
    let [x, y] = field.mesh.position(cell);
    for direction in 0..16 {
        let angle = direction as f64 * std::f64::consts::PI / 8.0;
        let point = [
            x + angle.cos() * p.landform_neighborhood_radius,
            y + angle.sin() * p.landform_neighborhood_radius,
        ];
        if sampler.sample(point, |cell| ice.get(cell))? >= thickness {
            return Ok(false);
        }
    }
    Ok(true)
}
pub(super) fn run(field: &Field, p: &Settings) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        field.shared.derive_code(C::LandformCodes).set(cell, 0)?;
    }
    let mesh = field.mesh.clone();
    let mut sampler = Sampler::new(&mesh);
    let water = field.water();
    let elevation = field.ground().view(GroundField::Elevation);
    let rivers = field.water.borrow();
    let reader = rivers.river_reader();
    for cell in 0..mesh.len() {
        let ice = field.shared.scalar(S::MaximumIceThickness).get(cell)?;
        let speed = if ice > 0.0 {
            field.shared.scalar(S::MaximumGroundedIceFlux).get(cell)? / (ice * mesh.spacing())
        } else {
            0.0
        };
        if water.column.kind.get(cell)? != 0 || speed <= p.glacier_frozen_speed {
            continue;
        }
        let mut form = 0;
        if field.shared.scalar(S::CumulativeGlacialErosion).get(cell)?
            >= MapScale::native(p.u_valley_minimum_glacial_erosion)
            && (reader.order_at(cell, 0) > 0
                || water.flow.mean.get(cell)? >= (p.river_accumulation_threshold / 2.0).trunc())
        {
            form = 9;
        }
        if elevation.get(cell)? - water.effective_sea_level
            >= MapScale::native(p.mountain_elevation)
            && cirque(field, &mut sampler, cell, p)?
        {
            form = 10;
        }
        if field
            .shared
            .scalar(S::CumulativeGlacialDeposition)
            .get(cell)?
            >= MapScale::native(p.moraine_minimum_glacial_deposition)
        {
            form = 12;
        }
        field.shared.derive_code(C::LandformCodes).set(cell, form)?;
    }
    Ok(())
}
