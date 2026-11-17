use super::{coast::shore_forcing, hold_ice, Forcing};
use crate::{
    field::shared::Scalar as F,
    magic::{
        channels::Channel as C,
        configuration::Source,
        inventory::{hosts, Inventory},
        sources::Environment,
        state::{Budget, MagicField},
        stocks::run::{self, Carriage},
    },
    rock::ground::Charge,
    scale::MapScale,
};
use std::io;
pub struct Record {
    pub system: String,
    pub epoch: i32,
    pub active_area: f64,
    pub maximum: f64,
    pub budget: Budget,
}
impl Record {
    pub fn description(&self) -> String {
        let km2 = |value: f64| (value / 1e6 + 0.5).floor();
        format!("{}: epoch {}, {} affected km², peak intensity {}; budget created {}, in reservoirs {}, stored {}, released {}, lost {} intensity·km²; accumulated activity, first occurrence and reservoirs travel with the crust.",
            self.system, self.epoch + 1, km2(self.active_area), self.maximum, km2(self.budget.created),
            km2(self.budget.carried), km2(self.budget.stored), km2(self.budget.released), km2(self.budget.lost))
    }
}
pub fn retained_charge(before: f64, fresh: f64, retention: f64, storage: f64) -> f64 {
    before.max(0.0) * retention + fresh.max(0.0) * storage
}
pub fn retain(
    env: &mut Environment<'_>,
    fields: &mut [MagicField],
    forcing: &mut Forcing,
    epoch: i32,
    carriage: &mut Carriage<'_>,
) -> io::Result<Vec<Record>> {
    for cell in 0..env.mesh.len() {
        env.fields.scalar_mut(F::IcePersistence).set(cell, 0.0)?;
        forcing.melt.set(cell, 0.0)?;
    }
    let mut records = Vec::new();
    for field in fields {
        run::advance(env, field, epoch, carriage)?;
        let (mut active, mut maximum) = (0.0, 0.0_f64);
        for cell in 0..env.mesh.len() {
            let value = field.channels.band(C::Intensity).get(cell)?;
            retain_at(env, field, cell, epoch)?;
            if value > 0.0 {
                active += env.mesh.area(cell);
            }
            maximum = maximum.max(value);
        }
        remember_strain(env, field)?;
        records.push(Record {
            system: field.definition.name.clone(),
            epoch,
            active_area: active,
            maximum,
            budget: field.budget(env.ground, env.mesh)?,
        });
    }
    Ok(records)
}
fn retain_at(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    cell: usize,
    epoch: i32,
) -> io::Result<()> {
    let ground = field.reservoir_index("ground");
    let before = if let Some((origin, stock)) = ground {
        field.origins[origin].stocks[stock].get(env.ground, cell)? / env.mesh.area(cell)
    } else {
        field.channels.band(C::Stored).get(cell)?
    };
    let value = field.channels.band(C::Intensity).get(cell)?;
    let stored = retained_charge(
        before,
        field.fresh.get(cell)?,
        field.definition.history.retention,
        field.definition.history.storage,
    );
    let history = field.channels.band_mut(C::History);
    history.set(cell, history.get(cell)? + value)?;
    let coastal = if field.definition.enabled && env.water.column.kind.get(cell)? == 0 {
        shore_forcing(env, field, cell)?
    } else {
        0.0
    };
    if coastal > 0.0 {
        let history = field.channels.band_mut(C::CoastalHistory);
        history.set(cell, history.get(cell)? + coastal)?;
        first(field, C::CoastalFirstEpoch, cell, epoch)?;
    }
    retain_ground(env, field, cell, (before, stored), ground)?;
    if value > 0.0 {
        first(field, C::FirstEpoch, cell, epoch)?;
    }
    thaw_subsidence(env, field, cell, before - stored)?;
    hold_ice(env, field, cell)
}
fn first(field: &mut MagicField, channel: C, cell: usize, epoch: i32) -> io::Result<()> {
    let values = field.channels.band_mut(channel);
    if values.get(cell)? < 0.0 {
        values.set(cell, f64::from(epoch))?;
    }
    Ok(())
}
fn retain_ground(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    cell: usize,
    values: (f64, f64),
    ground: Option<(usize, usize)>,
) -> io::Result<()> {
    let (before, stored) = values;
    let key = ground.and_then(
        |(origin, stock)| match field.origins[origin].stocks[stock] {
            Inventory::Ground(key) => Some(key),
            _ => None,
        },
    );
    let projected = if let Some(key) = key {
        let retained = before * field.definition.history.retention;
        env.ground
            .inventory_set(key, cell, retained * env.mesh.area(cell))?;
        env.ground.inventory_charge(
            key,
            cell,
            &Charge {
                amount: (stored - retained).max(0.0) * env.mesh.area(cell),
                reach: MapScale::native(field.definition.parameters.bury_depth),
                hosts: hosts(&field.definition.id, "ground").unwrap_or(&[]),
                from_rock: false,
                start: 0.0,
            },
        )?;
        env.ground.inventory_get(key, cell)? / env.mesh.area(cell)
    } else {
        stored
    };
    field.channels.band_mut(C::Stored).set(cell, projected)
}
fn thaw_subsidence(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    cell: usize,
    thawed: f64,
) -> io::Result<()> {
    if thawed <= 0.0 || !env.land_without_ice(cell)? {
        return Ok(());
    }
    let metres = field.definition.parameters.thaw_subsidence * thawed / 1000.0;
    if metres <= 0.0 {
        return Ok(());
    }
    let values = field.channels.band_mut(C::Subsided);
    values.set(cell, values.get(cell)? + metres)?;
    env.ground
        .displace(cell, -MapScale::native(metres), "aurora")
}
fn remember_strain(env: &mut Environment<'_>, field: &mut MagicField) -> io::Result<()> {
    for origin in 0..field.origins.len() {
        if field.definition.origins[origin].source != Source::Strain {
            continue;
        }
        let Some(stock) = field.stock_index(origin, "held") else {
            return Err(io::Error::other("Strain origin requires its held stock"));
        };
        for cell in 0..env.mesh.len() {
            let amount = field.origins[origin].source.get(cell)? * env.mesh.area(cell);
            field.origins[origin].stocks[stock].set(env.ground, cell, amount)?;
        }
    }
    Ok(())
}
