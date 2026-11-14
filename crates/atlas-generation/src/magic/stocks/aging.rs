use crate::{
    field::shared::Scalar as F,
    magic::{
        channels::Channel as C,
        sources::{Context, Environment},
        state::MagicField,
    },
    rock::ground::GroundField,
    scale::{MapScale, RelativeMeasure},
    water::column::Store,
};
use std::io;
pub fn decay_sap(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let soil = env
        .scale
        .resolve(RelativeMeasure::length(1.25e-7).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let water = env
        .scale
        .resolve(RelativeMeasure::length(2.5e-8).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let sap = &mut field.origins[context.origin].stocks[stock];
    for cell in 0..env.mesh.len() {
        let spent = sap.get(env.ground, cell)? * p.sap_loss;
        sap.add(env.ground, cell, -spent)?;
        if !env.land_without_ice(cell)? {
            continue;
        }
        let suitable = (env.ground.view(GroundField::SoilDepth).get(cell)? / soil).clamp(0.0, 1.0)
            * (env.water.column.store(Store::Soil).held(cell)? / water).clamp(0.0, 1.0);
        let seeds = suitable * spent / (env.mesh.area(cell) * p.grove_sap);
        for name in [F::BroadleafSeed, F::ConiferSeed] {
            let mut band = env.fields.scalar_mut(name);
            band.set(cell, (band.get(cell)? + seeds).clamp(0.0, 1.0))?;
        }
    }
    Ok(())
}
pub fn cool_forge(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
) -> io::Result<()> {
    let keep = 1.0 - field.origin_parameters(context.origin).forge_cooling;
    let values = &mut field.origins[context.origin].stocks[stock];
    for cell in 0..env.mesh.len() {
        let value = values.get(env.ground, cell)?;
        field.lost += value * (1.0 - keep);
        values.set(env.ground, cell, value * keep)?;
    }
    Ok(())
}
pub fn consume(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    origin: usize,
    stock: usize,
) -> io::Result<()> {
    let values = &mut field.origins[origin].stocks[stock];
    for cell in 0..env.mesh.len() {
        values.set(
            env.ground,
            cell,
            values.get(env.ground, cell)? * (1.0 - field.channels.band(C::Releasing).get(cell)?),
        )?;
    }
    Ok(())
}
pub fn gather_ice(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    origin: usize,
    stock: usize,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        field.origins[origin].stocks[stock].add(
            env.ground,
            cell,
            field.channels.band(C::Retained).get(cell)?,
        )?;
    }
    Ok(())
}
pub fn collapse_overdrawn(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let source = field.origins[context.origin].source.get(cell)?;
        let drawn = field.drawn.get(cell)?;
        if source <= 0.0 || drawn <= 0.0 || drawn < p.overdraw_share * source * env.mesh.area(cell)
        {
            continue;
        }
        field.channels.band_mut(C::Sealed).set(cell, 1.0)?;
        if p.sink_depth <= 0.0 {
            continue;
        }
        let subsided = field.channels.band_mut(C::Subsided);
        subsided.set(cell, subsided.get(cell)? + p.sink_depth)?;
        env.ground
            .displace(cell, -MapScale::native(p.sink_depth), "greenwood")?;
    }
    Ok(())
}
pub fn barren_fan(
    env: &mut Environment<'_>,
    field: &MagicField,
    context: Context,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let arrival = field.channels.band(C::Arrival).get(cell)?;
        if arrival < 0.0 {
            continue;
        }
        let age = f64::from(context.epoch) - arrival;
        if age < 0.0 || age >= p.fan_barren_epochs {
            continue;
        }
        let depth = (env.scalar(F::ImpactEjectaThickness, cell)?
            / MapScale::native(p.fan_barren_depth))
        .clamp(0.0, 1.0);
        let mut toxicity = env.fields.scalar_mut(F::EcologicalToxicity);
        toxicity.set(
            cell,
            toxicity
                .get(cell)?
                .max(depth * (1.0 - age / p.fan_barren_epochs)),
        )?;
    }
    Ok(())
}
