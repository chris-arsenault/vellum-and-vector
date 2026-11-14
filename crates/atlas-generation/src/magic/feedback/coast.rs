use super::Forcing;
use crate::{
    field::shared::Scalar as F,
    magic::{
        channels::Channel as C, confluences::Workspace, contact::receive_coastal_action,
        hallowed::coasts, sources::Environment, state::MagicField,
    },
    scale::RelativeMeasure,
    storage::Coverage,
};
use std::io;
pub fn shore_forcing(env: &Environment<'_>, field: &MagicField, cell: usize) -> io::Result<f64> {
    let multiplier = field.definition.effects.coastal_forcing;
    if multiplier == 0.0 {
        return Ok(0.0);
    }
    let (mut pressure, mut wave, mut current) = (0.0_f64, 0.0_f64, 0.0_f64);
    for edge in 0..3 {
        let Some(next) = env.mesh.neighbor(cell, edge) else {
            continue;
        };
        if env.water.column.kind.get(next)? != 1 {
            continue;
        }
        pressure = pressure.max(field.channels.band(C::Intensity).get(next)?);
        wave = wave.max(env.scalar(F::WaveExposure, next)?);
        current = current.max(env.scalar(F::OceanCurrentStrength, next)?);
    }
    let p = &field.definition.parameters;
    if pressure < p.coastal_threshold {
        return Ok(0.0);
    }
    Ok(
        (((pressure - p.coastal_threshold) * 1000.0 / (1000.0 - p.coastal_threshold)
            + wave * p.wave_amplification
            + current * p.current_amplification)
            * multiplier
            + 0.5)
            .floor()
            .clamp(1.0, 1000.0),
    )
}
pub fn feedback(
    env: &mut Environment<'_>,
    fields: &[MagicField],
    meetings: &Workspace,
    forcing: &mut Forcing,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut totals = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        totals.set(cell, shore_total(env, fields, cell)?)?;
    }
    let width = env
        .scale
        .resolve(RelativeMeasure::length(0.001).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    for state in &meetings.states {
        let strength = meetings.definitions[state.definition]
            .effects
            .coastal_forcing;
        if strength == 0.0 {
            continue;
        }
        for cell in 0..env.mesh.len() {
            if env.water.column.kind.get(cell)? == 0 {
                totals.set(
                    cell,
                    totals.get(cell)? + (strength * state.coverage.get(cell)? + 0.5).floor(),
                )?;
            }
        }
        receive_coastal_action(
            env,
            &state.coverage.read_only(),
            strength,
            width,
            &mut totals,
            coverage,
        )?;
    }
    if fields
        .iter()
        .any(|field| field.definition.enabled && field.definition.effects.warding > 0.0)
    {
        coasts::redirect(env, &mut totals, coverage)?;
    }
    for cell in 0..env.mesh.len() {
        let value = totals.get(cell)?;
        let mut external = env.fields.scalar_mut(F::ExternalCoastalForcing);
        external.set(cell, (external.get(cell)? + value).clamp(0.0, 1000.0))?;
        forcing.coastal.set(cell, value)?;
    }
    Ok(())
}
fn shore_total(env: &Environment<'_>, fields: &[MagicField], cell: usize) -> io::Result<f64> {
    if env.water.column.kind.get(cell)? != 0 {
        return Ok(0.0);
    }
    let mut total = 0.0;
    for field in fields.iter().filter(|field| field.definition.enabled) {
        let value = shore_forcing(env, field, cell)?;
        if value > 0.0 {
            total += value;
        }
    }
    Ok(total.clamp(0.0, 1000.0))
}
