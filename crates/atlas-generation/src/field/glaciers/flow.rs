use super::{
    surface::{self, Surface},
    Settings,
};
use crate::{
    field::{
        shared::{CellCode as C, Flag, Scalar as S},
        Field,
    },
    hpc::Direction,
    scale::MapScale,
    storage::Band,
};
use std::io;
fn targets(field: &mut Field, ice: &Surface, surface: &Band<f64>) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        if !ice.carries(cell)? {
            continue;
        }
        let mut best = -1;
        let mut slope = 0.0;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            let drop =
                (surface.get(cell)? - surface.get(next)?) / field.mesh.edge_length(cell, edge);
            if drop > slope {
                slope = drop;
                best = next as i32;
            }
        }
        field.shared.code_mut(C::IceFlowTargets).set(cell, best)?;
    }
    Ok(())
}
pub(super) fn run(field: &mut Field, p: &Settings) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        field.shared.code_mut(C::IceFlowTargets).set(cell, -1)?;
    }
    surface::refresh(field, p)?;
    let ice = Surface::new(&field.ground(), &field.shared, &field.water());
    let mut surface = field.coverage.get_mut().scratch(field.mesh.len(), 0.0);
    for cell in 0..field.mesh.len() {
        let thickness = field.shared.scalar(S::IceThickness).get(cell)?;
        surface.set(cell, ice.support(cell)? + MapScale::native(thickness))?;
        field.shared.scalar_mut(S::IceFlux).set(
            cell,
            thickness * field.mesh.area(cell) / p.ice_transport_years,
        )?;
    }
    targets(field, &ice, &surface)?;
    for cell in field
        .coverage
        .get_mut()
        .order(&surface.read_only(), Direction::Descending)?
    {
        let cell = cell?;
        if let Ok(target) = usize::try_from(field.shared.code(C::IceFlowTargets).get(cell)?) {
            let flux = field.shared.scalar_mut(S::IceFlux);
            flux.set(target, flux.get(target)? + flux.get(cell)?)?;
        }
    }
    for cell in 0..field.mesh.len() {
        let flux = field.shared.scalar(S::IceFlux).get(cell)?;
        let maximum = field.shared.scalar_mut(S::MaximumIceFlux);
        maximum.set(cell, maximum.get(cell)?.max(flux))?;
        if field.shared.flag(Flag::GroundedIce).get(cell)? != 0 {
            let maximum = field.shared.scalar_mut(S::MaximumGroundedIceFlux);
            maximum.set(cell, maximum.get(cell)?.max(flux))?;
        }
    }
    Ok(())
}
