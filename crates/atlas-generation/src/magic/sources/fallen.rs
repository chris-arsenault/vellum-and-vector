//! Fire supplied by actual impacts and released by the current cracking agents.
use super::{site_strength, Context, Environment};
use crate::{
    field::{events::EventKind, shared::Scalar as F},
    magic::{
        channels::Channel as C,
        inventory::{exposure, hosts, Inventory},
        state::{LocatedSource, MagicField},
    },
    scale::{LengthUnit, MapScale},
};
use std::io;
pub fn supply(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
) -> io::Result<()> {
    let held = 0;
    let parameters = field.origin_parameters(context.origin);
    for event in env.events {
        if event.kind != EventKind::Impact
            || event.epoch > context.epoch
            || !field.seeded.insert(event.id.clone())
        {
            continue;
        }
        if context.activity <= 0.0 {
            continue;
        }
        let Some(centre) = env.mesh.cell_at(event.x, event.y) else {
            continue;
        };
        let wind = [
            env.scalar(F::WindX, centre)? / 1000.0,
            env.scalar(F::WindY, centre)? / 1000.0,
        ];
        let mut total = 0.0;
        for cell in 0..env.mesh.len() {
            let [x, y] = env.mesh.position(cell);
            let dx = env.mesh.delta_x(x - event.x);
            let dy = y - event.y;
            let distance = dx.hypot(dy);
            if distance > event.radius * 2.4 {
                continue;
            }
            let downwind = if distance > 0.0 {
                ((dx * wind[0] + dy * wind[1]) / distance).max(0.0)
            } else {
                0.0
            };
            let ejecta = MapScale::metres(
                env.scalar(F::ImpactEjectaThickness, cell)?,
                LengthUnit::Native,
            );
            let amount = ejecta
                * env.mesh.area(cell)
                * parameters.fallen_density
                * (1.0 + 0.6 * downwind)
                * context.activity;
            if amount <= 0.0 {
                continue;
            }
            field.origins[context.origin].stocks[held].deposit_fallen(
                env.ground,
                cell,
                amount,
                env.mesh.area(cell),
                parameters.fallen_density,
            )?;
            total += amount;
            arrival(field, cell, context.epoch)?;
        }
        field.origins[context.origin].stocks[held].deposit_fallen(
            env.ground,
            centre,
            total * 0.2,
            env.mesh.area(centre),
            parameters.fallen_density,
        )?;
        arrival(field, centre, context.epoch)?;
    }
    Ok(())
}
fn arrival(field: &mut MagicField, cell: usize, epoch: i32) -> io::Result<()> {
    let before = field.channels.band(C::Arrival).get(cell)?;
    field
        .channels
        .band_mut(C::Arrival)
        .set(cell, before.max(epoch as f64))
}
pub fn locate(env: &Environment<'_>, field: &mut MagicField, context: Context) -> io::Result<()> {
    let held = 0;
    let parameters = field.origin_parameters(context.origin);
    for event in env.events {
        if event.kind == EventKind::Impact && event.epoch <= context.epoch {
            field.located.push(LocatedSource {
                origin: String::new(),
                id: event.id.clone(),
                x: event.x,
                y: event.y,
                radius: event.radius,
                strength: 1000.0,
            });
        }
    }
    for cell in 0..env.mesh.len() {
        field.channels.band_mut(C::Releasing).set(cell, 0.0)?;
        let stock = &field.origins[context.origin].stocks[held];
        let amount = stock.get(env.ground, cell)?;
        let mut strength = 0.0;
        if amount > 0.0 {
            let accessible = match stock {
                Inventory::Ground(key) => {
                    env.ground.inventory_reached(
                        *key,
                        cell,
                        MapScale::native(parameters.bury_depth),
                    )? / amount
                }
                Inventory::Mobile(_) => exposure(
                    env.ground,
                    cell,
                    parameters.bury_depth,
                    hosts(&field.definition.id, "held"),
                )?,
            };
            let releasing = accessible * release_share(env, field, context, cell)?;
            field.channels.band_mut(C::Releasing).set(cell, releasing)?;
            strength = amount * releasing / env.mesh.area(cell);
        }
        let heat = env.scalar(F::ImpactHeat, cell)?;
        if heat > 0.0 {
            let since = (context.epoch as f64
                - field.channels.band(C::Arrival).get(cell)?.max(0.0))
            .max(0.0);
            strength = strength
                .max(heat * parameters.impact_heat_share * context.activity / (1.0 + since));
        }
        let site = site_strength(strength);
        if site > 0.0 {
            field.channels.band_mut(C::Source).set(cell, site)?;
        }
    }
    Ok(())
}
fn release_share(
    env: &Environment<'_>,
    field: &MagicField,
    context: Context,
    cell: usize,
) -> io::Result<f64> {
    let p = field.origin_parameters(context.origin);
    let ice = env.scalar(F::IceThickness, cell)?;
    let mut share =
        p.fallen_release + p.strain_cracking * env.scalar(F::TectonicStrain, cell)? / 1000.0;
    share += p.ice_cracking * (ice / p.ice_crack_depth).clamp(0.0, 1.0);
    if env.scalar(F::Temperature, cell)? < 300.0 && ice <= 0.0 {
        share += p.frost_cracking;
    }
    if field.channels.band(C::Arrival).get(cell)? == context.epoch as f64 {
        share += p.impact_shock;
    }
    Ok(share.clamp(0.0, 1.0))
}
