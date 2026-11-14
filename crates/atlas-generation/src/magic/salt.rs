use super::{
    channels::Channel as C,
    inventory::{exposure, hosts, Inventory},
    sources::Environment,
    state::MagicField,
};
use crate::{
    field::shared::Scalar as F,
    rock::{catalogue, ground::alteration::Alteration, material::MaterialLayer},
    scale::{MapScale, RelativeMeasure},
    storage::ReadBand,
};
use std::io;
pub fn write(env: &mut Environment<'_>, fields: &mut [MagicField]) -> io::Result<()> {
    let fire = fields
        .iter()
        .find(|field| field.definition.enabled && field.definition.effects.quickening > 0.0)
        .map(|field| field.channel(C::Intensity));
    for field in fields
        .iter_mut()
        .filter(|field| field.definition.enabled && field.definition.effects.salting > 0.0)
    {
        for cell in 0..env.mesh.len() {
            if env.water.column.kind.get(cell)? != 0 {
                continue;
            }
            let p = field.definition.parameters.clone();
            let bed = exposed_amount(env, field, "bed", cell)? / env.mesh.area(cell);
            if bed >= p.glass_bed {
                fuse(env, cell, p.glass_resistance, p.glass_resistance)?;
            }
            let salting = field.channels.band(C::Intensity).get(cell)? / 1000.0
                * field.definition.effects.salting;
            if salting > 0.0 {
                let mut moisture = env.fields.scalar_mut(F::Moisture);
                moisture.set(
                    cell,
                    (moisture.get(cell)? * (1.0 - p.desiccation * salting) + 0.5).floor(),
                )?;
            }
            if let Some(fire) = &fire {
                if fire.get(cell)? > 0.0 {
                    burn(env, field, fire, cell)?;
                }
            }
        }
    }
    Ok(())
}
pub fn exposed_amount(
    env: &Environment<'_>,
    field: &MagicField,
    reservoir: &str,
    cell: usize,
) -> io::Result<f64> {
    let mut amount = 0.0;
    for (origin, definition) in field.definition.origins.iter().enumerate() {
        let burial = field.origin_parameters(origin).bury_depth;
        for (stock, definition) in definition.stocks.iter().enumerate() {
            if definition.reservoir != reservoir {
                continue;
            }
            amount += match &field.origins[origin].stocks[stock] {
                Inventory::Ground(key) => {
                    env.ground
                        .inventory_reached(*key, cell, MapScale::native(burial))?
                }
                Inventory::Mobile(band) => {
                    band.get(cell)?
                        * match hosts(&field.definition.id, reservoir) {
                            Some(kinds) => exposure(env.ground, cell, burial, Some(kinds))?,
                            None => 1.0,
                        }
                }
            };
        }
    }
    Ok(amount)
}
fn fuse(env: &mut Environment<'_>, cell: usize, resistance: f64, full: f64) -> io::Result<()> {
    fuse_rock(env, cell, resistance, resistance >= full * 0.5)?;
    env.ground.spoil_soil(cell, 1.0, "salt")
}
pub fn fuse_rock(
    env: &mut Environment<'_>,
    cell: usize,
    hardening: f64,
    glass: bool,
) -> io::Result<()> {
    if hardening == 0.0 && !glass {
        return Ok(());
    }
    let depth = MapScale::native(
        env.scale
            .resolve(RelativeMeasure::length(0.000035).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value(),
    );
    let epoch = env.ground.completed_epochs();
    let change = (hardening + 0.5).floor();
    env.ground.alter(
        cell,
        &Alteration {
            depth,
            offset: 0.0,
            from_rock: false,
            retained_only: false,
            facet: None,
            transform: &|layer| {
                let strength = (layer.strength + change)
                    .clamp(catalogue::SOFTEST_ROCK, catalogue::HARDEST_ROCK);
                Some(if glass {
                    MaterialLayer {
                        kind: 22,
                        secondary_kind: 22,
                        secondary_share: 0.0,
                        strength: strength.max(catalogue::kind_of_code(22).facts.resistance),
                        altered: epoch,
                        ..layer.clone()
                    }
                } else {
                    MaterialLayer {
                        strength,
                        altered: epoch,
                        ..layer.clone()
                    }
                })
            },
        },
    )
}
fn burn(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    fire: &ReadBand<f64>,
    cell: usize,
) -> io::Result<()> {
    let p = field.definition.parameters.clone();
    let share = (p.salt_burn * fire.get(cell)? / 1000.0).clamp(0.0, 1.0);
    let mut burnt = 0.0;
    for origin in 0..field.origins.len() {
        let burial = MapScale::native(field.origin_parameters(origin).bury_depth);
        for stock in 0..field.origins[origin].stocks.len() {
            let is_brine = field.definition.origins[origin].stocks[stock].reservoir == "brine";
            burnt += match &mut field.origins[origin].stocks[stock] {
                Inventory::Ground(key) => {
                    env.ground
                        .inventory_release(*key, cell, burial, &|_| share)?
                }
                Inventory::Mobile(band) => {
                    let removed = if is_brine {
                        band.get(cell)? * share
                    } else {
                        0.0
                    };
                    band.set(cell, band.get(cell)? - removed)?;
                    removed
                }
            };
        }
    }
    if burnt > 0.0 {
        field.lost += burnt;
        fuse(
            env,
            cell,
            p.glass_resistance * (burnt / (env.mesh.area(cell) * p.salt_full)).min(1.0),
            p.glass_resistance,
        )?;
    }
    Ok(())
}
