//! Elapsed reservoir aging and material transport remain separate from present-time reads.
use super::{aging, groundwater, ice, mobile, organic, salt, Transport};
use crate::{
    field::shared::Scalar,
    magic::{
        configuration::{Carrier, Renewal, Source},
        inventory::Inventory,
        sources::{Context, Environment},
        state::MagicField,
    },
    rock::load::MaterialLoad,
    storage::Coverage,
    water::network::RiverReader,
};
use std::io;
pub struct Carriage<'a> {
    pub transport: Transport<'a>,
    pub rivers: &'a RiverReader<'a>,
    pub load: &'a mut MaterialLoad,
}
pub fn advance(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    epoch: i32,
    carriage: &mut Carriage<'_>,
) -> io::Result<()> {
    for origin in 0..field.origins.len() {
        let context = Context {
            origin,
            epoch,
            activity: 1.0,
        };
        for stock in 0..field.origins[origin].stocks.len() {
            if stock == 0 && field.definition.origins[origin].renewal == Renewal::Finite {
                aging::consume(env, field, origin, stock)?;
            }
            age_reservoir(env, field, context, stock)?;
            transport_stock(env, field, context, stock, carriage)?;
        }
        match field.definition.origins[origin].source {
            Source::Impact => aging::barren_fan(env, field, context)?,
            Source::Aquifer => aging::collapse_overdrawn(env, field, context)?,
            _ => {}
        }
    }
    for cell in 0..env.mesh.len() {
        field.drawn.set(cell, 0.0)?;
    }
    Ok(())
}
fn age_reservoir(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
) -> io::Result<()> {
    match field.definition.origins[context.origin].stocks[stock]
        .reservoir
        .as_str()
    {
        "ice" => aging::gather_ice(env, field, context.origin, stock),
        "stratum" => organic::bury_living_charge(env, field, context, stock),
        "sap" => aging::decay_sap(env, field, context, stock),
        "forge" => aging::cool_forge(env, field, context, stock),
        _ => Ok(()),
    }
}
pub fn transport_retained(
    env: &mut Environment<'_>,
    fields: &mut [MagicField],
    carriage: &mut Carriage<'_>,
) -> io::Result<()> {
    for field in fields {
        for origin in 0..field.origins.len() {
            let context = Context {
                origin,
                epoch: 0,
                activity: 1.0,
            };
            for stock in 0..field.origins[origin].stocks.len() {
                transport_stock(env, field, context, stock, carriage)?;
            }
        }
    }
    Ok(())
}
fn transport_stock(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    carriage: &mut Carriage<'_>,
) -> io::Result<()> {
    match field.definition.origins[context.origin].stocks[stock]
        .reservoir
        .as_str()
    {
        "brine" => salt::seep_brine(
            env,
            field,
            context,
            stock,
            carriage.transport.coverage,
            carriage.transport.costs.river.as_ref(),
        )?,
        "bed" => salt::weather_bed(env, field, context, stock, &mut carriage.transport)?,
        "dust" => salt::settle_dust(env, field, context, stock, &mut carriage.transport)?,
        _ => {}
    }
    carry_stock(env, field, context, stock, carriage)
}
fn carry_stock(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    carriage: &mut Carriage<'_>,
) -> io::Result<()> {
    let definition = field.definition.origins[context.origin].stocks[stock].clone();
    if definition.carriers.contains(&Carrier::River) {
        if definition.reservoir == "sap" {
            organic::carry_litter(env, field, context, stock, carriage.rivers, carriage.load)?;
        } else if matches!(
            field.origins[context.origin].stocks[stock],
            Inventory::Mobile(_)
        ) {
            mobile::carry_downstream(
                env,
                field,
                context,
                stock,
                carriage.transport.coverage,
                mobile::RiverPassage {
                    rivers: carriage.rivers,
                    cost: carriage.transport.costs.river.as_ref(),
                },
            )?;
        }
    }
    if definition.carriers.contains(&Carrier::Ice) {
        ice::carry(
            env,
            field,
            context,
            stock,
            carriage.transport.coverage,
            carriage.transport.costs.ice.as_ref(),
        )?;
    }
    if definition.carriers.contains(&Carrier::Current) {
        ice::carry_shelf(env, field, context, stock, carriage.transport.coverage)?;
    }
    if definition.carriers.contains(&Carrier::Animal) {
        mobile::carry_in_gut(env, field, context, stock, carriage.transport.coverage)?;
    }
    Ok(())
}
pub fn exchange_water(
    env: &mut Environment<'_>,
    fields: &mut [MagicField],
    coverage: &mut Coverage,
) -> io::Result<()> {
    for field in fields {
        for origin in 0..field.origins.len() {
            let context = Context {
                origin,
                epoch: 0,
                activity: 1.0,
            };
            for stock in 0..field.origins[origin].stocks.len() {
                if field.definition.origins[origin].stocks[stock].reservoir == "stratum" {
                    groundwater::leach_living_strata(env, field, origin, stock)?;
                }
                if field.definition.origins[origin].stocks[stock]
                    .carriers
                    .contains(&Carrier::Groundwater)
                {
                    groundwater::carry(env, field, context, stock, coverage)?;
                }
            }
        }
    }
    Ok(())
}
pub fn respond_organic(
    env: &mut Environment<'_>,
    fields: &mut [MagicField],
    rivers: &RiverReader<'_>,
    load: &mut MaterialLoad,
) -> io::Result<()> {
    for field in fields {
        for origin in 0..field.origins.len() {
            let context = Context {
                origin,
                epoch: 0,
                activity: 1.0,
            };
            for stock in 0..field.origins[origin].stocks.len() {
                let definition = &field.definition.origins[origin].stocks[stock];
                if definition.reservoir == "stratum" {
                    organic::bury_living_charge(env, field, context, stock)?;
                } else if definition.reservoir == "sap"
                    && definition.carriers.contains(&Carrier::River)
                {
                    organic::carry_litter(env, field, context, stock, rivers, load)?;
                }
            }
        }
    }
    for name in [Scalar::OrganicBurialInput, Scalar::OrganicBurialThickness] {
        for cell in 0..env.mesh.len() {
            env.fields.scalar_mut(name).set(cell, 0.0)?;
        }
    }
    Ok(())
}
