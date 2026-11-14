use crate::{
    field::{shared::Scalar as S, Field},
    rock::ground::GroundField as G,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::{
        removal::{Cut, RemovalGround},
        stage::Pool,
    },
};
use std::io;
pub(super) fn maintenance(field: &mut Field, id: &str, native: f64) -> io::Result<()> {
    let record = field
        .landmark_ledger
        .iter_mut()
        .find(|record| record.id == id)
        .ok_or_else(|| io::Error::other("Landmark maintenance needs its emplaced record"))?;
    record.maintenance += MapScale::metres(native, LengthUnit::Native);
    Ok(())
}
pub(super) fn add(field: &mut Field, band: S, cell: usize, value: f64) -> io::Result<()> {
    let band = field.shared.scalar_mut(band);
    band.set(cell, band.get(cell)? + value)
}
pub(super) fn shift(field: &mut Field, cell: usize, requested: f64) -> io::Result<f64> {
    if requested != 0.0 {
        field
            .ground
            .try_borrow_mut()
            .map_err(io::Error::other)?
            .displace(cell, requested, "landmarks")?;
    }
    Ok(requested)
}
pub(super) fn cut(field: &mut Field, cell: usize, requested: f64) -> io::Result<f64> {
    let clearance = field
        .scale
        .resolve(RelativeMeasure::length(2.5e-7).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let base = field.water().effective_sea_level + MapScale::native(clearance);
    let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
    let amount = requested.min(ground.view(G::Elevation).get(cell)? - base);
    if amount <= 0.0 {
        return Ok(0.0);
    }
    let area = field.mesh.area(cell);
    let actual = ground.cut(
        Cut {
            cell,
            depth: amount,
            share: 1.0,
            cause: "landmarks",
            floor: f64::NEG_INFINITY,
        },
        &mut |mut material| {
            material.depth = MapScale::metres(material.depth, LengthUnit::Native) * area;
            field.ground_load.add(cell, &material)
        },
    )?;
    ground.record_sediment_export(
        MapScale::metres(actual.amount, LengthUnit::Native) * area,
        0.0,
    );
    drop(ground);
    add(field, S::CumulativeFluvialErosion, cell, actual.depth)?;
    Ok(amount)
}
pub(super) fn excavate(field: &mut Field, cell: usize, requested: f64) -> io::Result<f64> {
    if requested <= 0.0 {
        return Ok(0.0);
    }
    let mut ground = field.ground.try_borrow_mut().map_err(io::Error::other)?;
    let amount =
        ground.excavate_rock(cell, requested, "landmarks", Pool::Space, &mut |_| Ok(()))?;
    let volume = MapScale::metres(amount, LengthUnit::Native) * field.mesh.area(cell);
    ground.record_sediment_export(volume, volume);
    drop(ground);
    add(field, S::ImpactExcavation, cell, amount)?;
    Ok(amount)
}
