use crate::{
    field::shared::Scalar as F,
    magic::{
        channels::Channel as C, configuration::Renewal, inventory::Inventory,
        material::seal_conduit, sources::Environment, state::MagicField,
    },
};
use std::io;
pub fn feedback(
    env: &mut Environment<'_>,
    fields: &mut [MagicField],
    floor: f64,
) -> io::Result<()> {
    for cell in 0..env.mesh.len() {
        if env.water.column.kind.get(cell)? == 1 {
            continue;
        }
        for field in fields.iter_mut().filter(|field| {
            field.definition.enabled && field.definition.effects.conduit_opening > 0.0
        }) {
            evolve(env, field, cell, floor)?;
        }
    }
    Ok(())
}
fn evolve(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    cell: usize,
    floor: f64,
) -> io::Result<()> {
    if field.channels.band(C::Sealed).get(cell)? > 0.0 {
        let mut band = env.fields.scalar_mut(F::FractureConductance);
        return band.set(cell, band.get(cell)?.min(floor));
    }
    let intensity = field.channels.band(C::Intensity).get(cell)?;
    if intensity < 230.0 {
        return Ok(());
    }
    if field.channels.band(C::History).get(cell)? + intensity
        >= field.definition.parameters.conduit_budget
    {
        field.channels.band_mut(C::Sealed).set(cell, 1.0)?;
        seal_conduit(env, cell)?;
        env.fields
            .scalar_mut(F::FractureConductance)
            .set(cell, floor)?;
        harden_cores(env, field, cell)?;
    } else {
        let mut band = env.fields.scalar_mut(F::FractureConductance);
        band.set(
            cell,
            (band.get(cell)?
                + (field.definition.effects.conduit_opening * intensity / 1000.0 + 0.5).floor())
            .min(1000.0),
        )?;
    }
    Ok(())
}
fn harden_cores(env: &mut Environment<'_>, field: &mut MagicField, cell: usize) -> io::Result<()> {
    let Some(origin) = field
        .definition
        .origins
        .iter()
        .position(|origin| origin.renewal == Renewal::ConduitFed)
    else {
        return Ok(());
    };
    let Some(spent) = field.stock_index(origin, "spent") else {
        return Ok(());
    };
    let amount = field.origins[origin].stocks[0].get(env.ground, cell)?;
    if let (Inventory::Ground(held), Inventory::Ground(spent)) = (
        &field.origins[origin].stocks[0],
        &field.origins[origin].stocks[spent],
    ) {
        env.ground.inventory_transfer(*held, cell, amount, *spent)?;
    } else {
        field.origins[origin].stocks[spent].add(env.ground, cell, amount)?;
        field.origins[origin].stocks[0].set(env.ground, cell, 0.0)?;
    }
    Ok(())
}
