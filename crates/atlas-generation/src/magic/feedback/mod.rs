pub mod coast;
pub mod history;
pub mod ocean;
pub mod rock;
use super::{
    channels::Channel as C, hallowed::rims::Rims, sources::Environment, state::MagicField,
    stocks::ice,
};
use crate::{
    field::{
        shared::{CellCode, Scalar as F},
        surface_media::Melt,
    },
    scale::{LengthUnit, RelativeMeasure},
    storage::{Band, Coverage},
    water::{network::RiverReader, Water},
};
use std::io;
pub struct Forcing {
    pub heat: Band<f64>,
    pub melt: Band<f64>,
    pub upwelling: Band<f64>,
    pub sea_surface: Band<f64>,
    pub fog: Band<f64>,
    pub coastal: Band<f64>,
}
impl Forcing {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            heat: coverage.allocate(0.0),
            melt: coverage.allocate(0.0),
            upwelling: coverage.allocate(0.0),
            sea_surface: coverage.allocate(0.0),
            fog: coverage.allocate(0.0),
            coastal: coverage.allocate(0.0),
        }
    }
}
pub fn held_charge(env: &Environment<'_>, field: &MagicField, cell: usize) -> io::Result<f64> {
    if field.definition.effects.ice_persistence == 0.0 {
        return Ok(1.0);
    }
    let stored = field.channels.band(C::Stored).get(cell)?;
    let skin = env
        .scale
        .resolve(
            RelativeMeasure::new(0.0000125, 1, 0.5, LengthUnit::Metre).map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value();
    Ok(held_charge_values(
        stored,
        field.channels.band(C::Intensity).get(cell)?,
        env.scalar(F::IceThickness, cell)?,
        skin,
        field.definition.parameters.relict_strength,
    ))
}
pub fn held_charge_values(
    stored: f64,
    intensity: f64,
    ice: f64,
    skin: f64,
    relict_strength: f64,
) -> f64 {
    let strength = ((stored - 300.0) / 150.0).max((intensity - 600.0) / 300.0);
    let relict = relict_strength * ((stored - 300.0) / 150.0).clamp(0.0, 1.0);
    strength.clamp(0.0, 1.0) * (ice / skin).clamp(0.0, 1.0).max(relict)
}
pub fn thermal(
    env: &mut Environment<'_>,
    water: &mut Water,
    fields: &mut [MagicField],
    forcing: &mut Forcing,
    exposure: f64,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        let mut flags = env.fields.code(CellCode::FeatureFlags).get(cell)? & !((1 << 3) | (1 << 4));
        let mut heat = 0.0;
        let mut melt = 0.0;
        for field in fields.iter().filter(|field| field.definition.enabled) {
            let effects = &field.definition.effects;
            let intensity = field.channels.band(C::Intensity).get(cell)?;
            heat += intensity
                * effects.heat
                * if effects.heat < 0.0 {
                    held_charge(env, field, cell)?
                } else {
                    1.0
                };
            melt += intensity * effects.ice_melt;
            if effects.heat > 0.0
                && field.channels.band(C::Source).get(cell)? > 0.0
                && intensity > 0.0
            {
                flags |= 1 << 3;
                if intensity >= 940.0 {
                    flags |= 1 << 4;
                }
            }
        }
        env.fields
            .code_mut(CellCode::FeatureFlags)
            .set(cell, flags)?;
        let previous = forcing.heat.get(cell)?;
        let rounded = (heat + 0.5).floor();
        forcing.heat.set(cell, rounded)?;
        let mut external = env.fields.scalar_mut(F::ExternalHeatForcing);
        external.set(cell, external.get(cell)? + rounded - previous)?;
        drop(external);
        apply_melt(
            env,
            water,
            fields,
            forcing,
            cell,
            (melt * exposure, exposure),
        )?;
    }
    Ok(())
}
fn apply_melt(
    env: &mut Environment<'_>,
    water: &mut Water,
    fields: &mut [MagicField],
    forcing: &mut Forcing,
    cell: usize,
    response: (f64, f64),
) -> io::Result<()> {
    let (melt, exposure) = response;
    if exposure <= 0.0 {
        return Ok(());
    }
    let owed = ((melt + 0.5).floor() - forcing.melt.get(cell)?).max(0.0);
    let melted = ice::melt(
        env,
        water,
        fields,
        &Melt {
            cell,
            amount: owed,
            cause: "fire".into(),
            beneath: true,
            exposure,
        },
    )?;
    forcing.melt.set(cell, forcing.melt.get(cell)? + melted)
}
pub fn living(
    env: &mut Environment<'_>,
    fields: &[MagicField],
    rivers: &RiverReader<'_>,
    elapsed: bool,
    rims: &mut Rims,
    coverage: &mut Coverage,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        let mut amounts = [0.0; 6];
        for field in fields.iter().filter(|field| field.definition.enabled) {
            let share = field.channels.band(C::Intensity).get(cell)? / 1000.0;
            let e = &field.definition.effects;
            let effects = [
                e.quickening,
                e.stillness * held_charge(env, field, cell)?,
                e.verdure,
                e.salting,
                e.warding,
                e.tearing,
            ];
            for (amount, effect) in amounts.iter_mut().zip(effects) {
                *amount += share * effect;
            }
        }
        for (name, value) in [
            F::Quickening,
            F::Stillness,
            F::Verdure,
            F::Salting,
            F::Warding,
            F::Tearing,
        ]
        .into_iter()
        .zip(amounts)
        {
            env.fields
                .scalar_mut(name)
                .set(cell, value.clamp(0.0, 1.0))?;
        }
        let green = amounts[2].clamp(0.0, 1.0);
        let kind = env.water.column.kind.get(cell)?;
        if elapsed && green > 0.3 && kind == 0 && rivers.order_at(cell, kind) > 0 {
            let mut wet = env.fields.scalar_mut(F::WetlandCover);
            wet.set(cell, wet.get(cell)?.max(0.5 * green))?;
        }
    }
    rims.mark(env, coverage)
}
pub fn hold_ice(env: &mut Environment<'_>, field: &MagicField, cell: usize) -> io::Result<()> {
    let held = ((field.channels.band(C::Stored).get(cell)? - 300.0) / 150.0).clamp(0.0, 1.0);
    let shelf = field.reservoir_index("shelf");
    let shelved = if let Some((origin, stock)) = shelf {
        if env.water.column.kind.get(cell)? == 1 {
            (field.origins[origin].stocks[stock].get(env.ground, cell)?
                / (env.mesh.area(cell) * field.definition.parameters.shelf_saturation))
                .clamp(0.0, 1.0)
        } else {
            0.0
        }
    } else {
        0.0
    };
    let mut band = env.fields.scalar_mut(F::IcePersistence);
    band.set(
        cell,
        band.get(cell)?
            .max(field.definition.effects.ice_persistence * held.max(shelved)),
    )
}
pub fn refresh_ice(env: &mut Environment<'_>, fields: &[MagicField]) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        env.fields.scalar_mut(F::IcePersistence).set(cell, 0.0)?;
    }
    for field in fields
        .iter()
        .filter(|field| field.definition.enabled && field.definition.effects.ice_persistence > 0.0)
    {
        for cell in 0..env.mesh.len() {
            hold_ice(env, field, cell)?;
        }
    }
    Ok(())
}
