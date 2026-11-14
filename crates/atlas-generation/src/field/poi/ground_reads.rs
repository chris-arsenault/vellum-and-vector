//! Material tests shared by ground places and the works which consume their deposits.
use super::{cover_shared, kinds::Kind, places, reads, state::State, values::*, water_reads};
use crate::{
    climate::air_year,
    field::{
        climate::settings::Settings, refinement::topology::distance, shared::Scalar,
        significance::measure,
    },
    magic::channels::Channel,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use std::io;

pub trait GroundState: State {
    fn climate_settings(&self) -> &Settings;
    fn basin_bowl(&self) -> Option<&[u8]>;
}
pub fn stock_per_area(state: &impl State, system: &str, key: &str, cell: usize) -> io::Result<f64> {
    let Some(magic) = reads::magic_field(state, system) else {
        return Ok(0.0);
    };
    let field = state.field()?;
    Ok(magic.stock_amount(&field.ground(), key, cell)? / field.mesh.area(cell))
}
pub fn reservoir_per_area(
    state: &impl State,
    system: &str,
    reservoir: &str,
    cell: usize,
) -> io::Result<f64> {
    let Some(magic) = reads::magic_field(state, system) else {
        return Ok(0.0);
    };
    let field = state.field()?;
    Ok(magic.reservoir_amount(&field.ground(), reservoir, cell)? / field.mesh.area(cell))
}
pub fn sealed(state: &impl State, system: &str, cell: usize) -> io::Result<bool> {
    Ok(reads::magic_value(state, system, Channel::Sealed, cell)? > 0.0)
}
pub fn rule_floor(state: &impl State, system: &str, rule: &str, reading: &str) -> Option<f64> {
    let field = reads::magic_field(state, system)?;
    let rule = field.definition().features.iter().find(|f| f.id == rule)?;
    rule.retains
        .as_ref()
        .unwrap_or(&rule.seeds)
        .iter()
        .flatten()
        .filter(|c| c.field == reading)
        .filter_map(|c| c.min)
        .reduce(f64::min)
}
pub fn flow_gradient(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let Some(target) = water_reads::flow_target(field, cell)? else {
        return Ok(0.0);
    };
    let run = distance(&field.mesh, cell, target);
    let elevation = field.ground().view(GroundField::Elevation);
    let fall = MapScale::metres(
        elevation.get(cell)? - elevation.get(target)?,
        LengthUnit::Native,
    );
    Ok(if run > 0.0 {
        (fall / run).max(0.0)
    } else {
        0.0
    })
}
pub fn gradient_into(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let mut steepest = 0.0f64;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            if reads::has_channel(field, next)?
                && water_reads::flow_target(field, next)? == Some(cell)
            {
                steepest = steepest.max(flow_gradient(state, next)?);
            }
        }
    }
    Ok(steepest)
}
pub fn sediment(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(MapScale::metres(
        state
            .field()?
            .ground()
            .view(GroundField::SedimentThickness)
            .get(cell)?,
        LengthUnit::Native,
    ))
}
pub fn land(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(state.field()?.water().column.kind.get(cell)? == 0)
}
pub fn natural_bar(state: &impl State, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    if !land(state, cell)?
        || reads::magic_rule(state, "fire", "placer", cell)?
        || !reads::has_channel(field, cell)?
        || sediment(state, cell)? < measure(&field.scale, 0.00000025, 1, 0.5)?
        || cover_shared::scalar(state, Scalar::DeltaIntensity, cell)? > 0.0
    {
        return Ok(false);
    }
    let above = gradient_into(state, cell)?;
    Ok(above >= 0.001 && flow_gradient(state, cell)? <= 0.5 * above)
}
pub fn placer(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(reads::magic_rule(state, "fire", "placer", cell)? || natural_bar(state, cell)?)
}
pub fn spill_depth(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    Ok(MapScale::metres(
        field.water().drainage.elevations.get(cell)?
            - field.ground().view(GroundField::Elevation).get(cell)?,
        LengthUnit::Native,
    ))
}
pub fn closed_by_aridity(state: &impl GroundState, cell: usize) -> io::Result<bool> {
    let field = state.field()?;
    let settings = state.climate_settings();
    let latitude = settings
        .latitude()
        .latitude_at_y(field.mesh.position(cell)[1] + field.mesh.origin()[1]);
    let read = |name| cover_shared::scalar(state, name, cell);
    let demand: f64 = air_year(
        latitude,
        settings.axial_tilt,
        read(Scalar::Temperature)?,
        read(Scalar::Seasonality)?,
        0.0,
    )
    .demand
    .iter()
    .sum();
    Ok(read(Scalar::Rainfall)? + read(Scalar::Snowfall)? < 0.5 * demand)
}
pub fn natural_pan(state: &impl GroundState, cell: usize) -> io::Result<bool> {
    Ok(land(state, cell)?
        && !reads::magic_rule(state, "salt", "pan", cell)?
        && !reads::magic_rule(state, "salt", "flat", cell)?
        && spill_depth(state, cell)? > 0.0
        && cover_shared::scalar(state, Scalar::Slope, cell)? <= 0.006
        && cover_shared::scalar(state, Scalar::IceThickness, cell)? <= 0.0
        && cover_shared::living_cover(state, cell)? < 0.12
        && closed_by_aridity(state, cell)?)
}
pub fn pan(state: &impl GroundState, cell: usize) -> io::Result<bool> {
    Ok(reads::magic_rule(state, "salt", "pan", cell)? || natural_pan(state, cell)?)
}
pub fn full_salt(state: &impl State) -> f64 {
    reads::magic_field(state, "salt").map_or(400.0, |f| f.definition().parameters.salt_full)
}
pub fn killing_floor(state: &impl State) -> f64 {
    rule_floor(state, "salt", "ground", "stock:death/brine").unwrap_or(20.0)
}
pub fn recorded_brine(state: &impl State, cell: usize) -> io::Result<f64> {
    let field = state.field()?;
    let made = match reads::magic_field(state, "salt") {
        Some(magic) => magic.definition().parameters.salt_per_death,
        None => measure(&field.scale, 3.125e-7, 2, 1.0)?,
    };
    Ok(field
        .people()
        .view(crate::human::HumanField::MassDeath)
        .get(cell)?
        * made
        / field.mesh.area(cell))
}
pub fn natural_killing(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(land(state, cell)?
        && !reads::magic_rule(state, "salt", "ground", cell)?
        && recorded_brine(state, cell)? >= killing_floor(state))
}
pub fn killing(state: &impl State, cell: usize) -> io::Result<bool> {
    Ok(reads::magic_rule(state, "salt", "ground", cell)? || natural_killing(state, cell)?)
}
pub fn grown_and_natural(
    state: &impl State,
    kind: Kind,
    system: &str,
    rule: &str,
    natural: impl Fn(usize) -> io::Result<bool>,
    rank: impl Fn(usize) -> io::Result<f64>,
) -> io::Result<Vec<Place>> {
    let mut found = places::rule_places(state, kind, system, rule)?
        .as_ref()
        .clone();
    found.extend(
        places::region_places(state, kind, natural, rank)?
            .iter()
            .cloned(),
    );
    Ok(found)
}
pub fn area(state: &impl State, place: &Place) -> io::Result<f64> {
    let field = state.field()?;
    Ok(place.cells.iter().map(|&cell| field.mesh.area(cell)).sum())
}
pub fn length(state: &impl State, place: &Place) -> io::Result<f64> {
    Ok(place.cells.len() as f64 * state.field()?.scale.cells(1.0))
}
pub fn around(state: &impl State) -> io::Result<f64> {
    let scale = &state.field()?.scale;
    Ok(scale.supported(measure(scale, 0.0075, 1, 1.0)?, 2.0))
}
pub fn salting(state: &impl State, cell: usize) -> io::Result<f64> {
    cover_shared::scalar(state, Scalar::Salting, cell)
}
pub fn moisture(state: &impl State, cell: usize) -> io::Result<f64> {
    Ok(cover_shared::scalar(state, Scalar::Moisture, cell)? / 1000.0)
}
