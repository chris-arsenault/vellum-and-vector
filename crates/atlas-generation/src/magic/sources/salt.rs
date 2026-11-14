use super::{site_strength, Context, Environment};
use crate::{
    field::shared::Scalar,
    magic::{channels::Channel, configuration::Source, state::MagicField},
    rock::ground::GroundField,
    water::Water,
};
use std::io;
pub fn supply_death(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    deaths: &mut dyn FnMut(usize) -> io::Result<f64>,
) -> io::Result<()> {
    let Some(brine) = field.stock_index(context.origin, "brine") else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let dead = deaths(cell)?;
        if dead <= 0.0 {
            continue;
        }
        let made = dead * p.salt_per_death * context.activity;
        if made > 0.0 {
            field.origins[context.origin].stocks[brine].add(env.ground, cell, made)?;
        }
    }
    Ok(())
}
pub fn supply_lake(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    water: &mut Water,
) -> io::Result<()> {
    let Some(bed) = field.stock_index(context.origin, "bed") else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    let elevation = env.ground.view(GroundField::Elevation);
    for cell in 0..env.mesh.len() {
        let memory = env.water.column.lake_memory.get(cell)?;
        if memory <= 0.0
            || env.water.column.kind.get(cell)? != 0
            || env.scalar(Scalar::IceThickness, cell)? > 0.0
        {
            continue;
        }
        if env.water.drainage.elevations.get(cell)? <= elevation.get(cell)? {
            continue;
        }
        let made = memory * env.mesh.area(cell) * p.salt_per_lake_metre * context.activity;
        water.forget_lake(cell)?;
        if made > 0.0 {
            field.origins[context.origin].stocks[bed].deposit_salt(
                env.ground,
                cell,
                made,
                env.mesh.area(cell),
                p.salt_material_density,
            )?;
        }
    }
    Ok(())
}
pub fn locate(env: &Environment<'_>, field: &mut MagicField, context: Context) -> io::Result<()> {
    let reservoir = if field.definition.origins[context.origin].source == Source::Death {
        "brine"
    } else {
        "bed"
    };
    let Some(stock) = field.stock_index(context.origin, reservoir) else {
        return Ok(());
    };
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let amount = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
        field.channels.band_mut(Channel::Source).set(
            cell,
            site_strength(1000.0 * amount / env.mesh.area(cell) / p.salt_full),
        )?;
    }
    Ok(())
}
