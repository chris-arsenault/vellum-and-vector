use super::{reads, state::State, values::Place};
use crate::{
    field::{shared::Scalar, significance::measure},
    magic::{channels::Channel, feedback::held_charge_values},
};
use std::io;
pub fn country(state: &impl State, fraction: f64) -> io::Result<f64> {
    let scale = &state.field()?.scale;
    Ok(scale.supported(measure(scale, fraction, 1, 1.0)?, 2.0))
}
pub fn intensity(state: &impl State, system: &str, cell: usize) -> io::Result<f64> {
    reads::magic_value(state, system, Channel::Intensity, cell)
}
pub fn origin_source(
    state: &impl State,
    system: &str,
    origin: &str,
    cell: usize,
) -> io::Result<f64> {
    let Some(field) = reads::magic_field(state, system) else {
        return Ok(0.0);
    };
    let Some(index) = field
        .definition()
        .origins
        .iter()
        .position(|o| o.id == origin)
    else {
        return Ok(0.0);
    };
    field.origin_source(index).get(cell)
}
pub fn peak(place: &Place, read: impl Fn(usize) -> io::Result<f64>) -> io::Result<f64> {
    let mut peak = 0.0f64;
    for &cell in &place.cells {
        peak = peak.max(read(cell)?);
    }
    Ok(peak)
}
pub fn weighted_area(
    state: &impl State,
    place: &Place,
    share: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<f64> {
    let mesh = &state.field()?.mesh;
    let mut sum = 0.0;
    for &cell in &place.cells {
        sum += mesh.area(cell) * share(cell)?;
    }
    Ok(sum)
}
pub fn held_charge(state: &impl State, cell: usize) -> io::Result<f64> {
    let Some(aurora) = reads::magic_field(state, "aurora") else {
        return Ok(0.0);
    };
    if aurora.definition().effects.ice_persistence == 0.0 {
        return Ok(1.0);
    }
    let field = state.field()?;
    Ok(held_charge_values(
        aurora.channel(Channel::Stored).get(cell)?,
        aurora.channel(Channel::Intensity).get(cell)?,
        field.shared.scalar(Scalar::IceThickness).get(cell)?,
        measure(&field.scale, 0.0000125, 1, 0.5)?,
        aurora.definition().parameters.relict_strength,
    ))
}
pub fn stock_reading(state: &impl State, system: &str, key: &str, cell: usize) -> io::Result<f64> {
    let Some(magic) = reads::magic_field(state, system) else {
        return Ok(0.0);
    };
    let field = state.field()?;
    magic.stock_reading(&field.ground(), &field.mesh, key, cell)
}
