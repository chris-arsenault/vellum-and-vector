mod beams;
pub mod channels;
pub mod cold;
pub mod ocean;
pub mod run;
use super::{
    channels::Channel as C,
    inventory::{exposure, hosts, Inventory},
    sources::{Context, Environment},
    state::MagicField,
};
use crate::{scale::RelativeMeasure, storage::ReadBand};
use std::io;
pub fn local(
    env: &Environment<'_>,
    field: &mut MagicField,
    source: &ReadBand<f64>,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        field
            .channels
            .band_mut(C::Intensity)
            .set(cell, source.get(cell)?)?;
    }
    Ok(())
}
pub fn radial(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    shared: bool,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let minimum = env
        .scale
        .resolve(RelativeMeasure::length(0.00000025).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    let origin = &field.definition.origins[context.origin].id;
    for source in &field.located {
        if !shared && source.origin != *origin {
            continue;
        }
        let radius = if source.radius != 0.0 {
            source.radius
        } else {
            minimum.max(p.source_spacing)
        };
        for cell in 0..env.mesh.len() {
            let [x, y] = env.mesh.position(cell);
            let distance = (x - source.x).hypot(y - source.y);
            let before = field.channels.band(C::Intensity).get(cell)?;
            field.channels.band_mut(C::Intensity).set(
                cell,
                before.max(source.strength * (1.0 - distance / radius).max(0.0)),
            )?;
        }
    }
    Ok(())
}
pub fn brine(env: &Environment<'_>, field: &mut MagicField, context: Context) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let mut salt = 0.0;
        for reservoir in ["brine", "bed", "dust"] {
            salt += exposed_reservoir(env, field, reservoir, cell)?;
        }
        field.channels.band_mut(C::Intensity).set(
            cell,
            (1000.0 * salt / env.mesh.area(cell) / p.salt_full + 0.5)
                .floor()
                .clamp(0.0, 1000.0),
        )?;
    }
    Ok(())
}
pub fn exposed_reservoir(
    env: &Environment<'_>,
    field: &MagicField,
    reservoir: &str,
    cell: usize,
) -> io::Result<f64> {
    let mut amount = 0.0;
    for (origin, state) in field.definition.origins.iter().zip(&field.origins) {
        let burial = origin
            .parameters
            .bury_depth
            .unwrap_or(field.definition.parameters.bury_depth);
        for (stock, values) in origin.stocks.iter().zip(&state.stocks) {
            if stock.reservoir != reservoir {
                continue;
            }
            amount += match values {
                Inventory::Ground(key) => env.ground.inventory_reached(
                    *key,
                    cell,
                    crate::scale::MapScale::native(burial),
                )?,
                Inventory::Mobile(values) => {
                    let availability = match hosts(&field.definition.id, reservoir) {
                        Some(kinds) => exposure(env.ground, cell, burial, Some(kinds))?,
                        None => 1.0,
                    };
                    values.get(cell)? * availability
                }
            };
        }
    }
    Ok(amount)
}
