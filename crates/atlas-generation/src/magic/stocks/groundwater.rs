use crate::{
    magic::{
        inventory::Inventory,
        sources::{Context, Environment},
        state::MagicField,
    },
    rock::ground::query::{material_fact, Fact},
    scale::{MapScale, RelativeMeasure},
    storage::Coverage,
    water::{column::Store, groundwater::returned_charge},
};
use std::io;
pub fn leach_living_strata(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    origin: usize,
    stock: usize,
) -> io::Result<()> {
    let Some((water_origin, water_stock)) =
        field
            .definition
            .origins
            .iter()
            .enumerate()
            .find_map(|(origin, definition)| {
                definition
                    .stocks
                    .iter()
                    .position(|stock| stock.reservoir == "aquifer")
                    .map(|stock| (origin, stock))
            })
    else {
        return Ok(());
    };
    let Inventory::Ground(key) = field.origins[origin].stocks[stock] else {
        return Ok(());
    };
    let reach = env
        .scale
        .resolve(RelativeMeasure::length(2.5e-6).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value();
    for cell in 0..env.mesh.len() {
        if env.water.column.kind.get(cell)? == 1 {
            continue;
        }
        let wet = ((env.water.groundwater.recharge.get(cell)?
            + env.water.column.store(Store::Ground).held(cell)?)
            / reach)
            .clamp(0.0, 1.0);
        if wet <= 0.0 {
            continue;
        }
        let amount =
            env.ground
                .inventory_release(key, cell, MapScale::native(reach), &|layer| {
                    wet * material_fact(layer, Fact::Porosity) * 0.2
                })?;
        field.origins[water_origin].stocks[water_stock].add(env.ground, cell, amount)?;
    }
    Ok(())
}
pub fn carry(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let brine = if field.definition.effects.salting > 0.0 {
        field.stock_index(context.origin, "brine")
    } else {
        None
    };
    let spring = field.stock_index(context.origin, "springwater");
    let p = field.origin_parameters(context.origin);
    let mut moved = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        if let Some(spring) = spring {
            field.origins[context.origin].stocks[spring].set(env.ground, cell, 0.0)?;
        }
        if env.water.column.kind.get(cell)? == 1 {
            let water = &mut field.origins[context.origin].stocks[stock];
            field.lost += water.get(env.ground, cell)?;
            water.set(env.ground, cell, 0.0)?;
            continue;
        }
        recharge(
            env,
            field,
            context.origin,
            [stock, brine.unwrap_or(stock)],
            cell,
            if brine.is_some() { p.seep_share } else { 0.0 },
        )?;
        let water = &mut field.origins[context.origin].stocks[stock];
        let held = water.get(env.ground, cell)?;
        let volume = env.water.groundwater.exchange.get(cell)?;
        if held <= 0.0 || volume <= 0.0 {
            continue;
        }
        let released = held * env.water.groundwater.returned.get(cell)? / volume;
        let carried = held * env.water.groundwater.outflow.get(cell)? / volume;
        water.add(env.ground, cell, -released - carried)?;
        if let Some(receiver) = brine.or(spring) {
            field.origins[context.origin].stocks[receiver].add(env.ground, cell, released)?;
        } else {
            field.lost += released;
        }
        let target = env.water.groundwater.targets.get(cell)?;
        if target >= 0 && env.water.column.kind.get(target as usize)? != 1 {
            moved.set(target as usize, moved.get(target as usize)? + carried)?;
        } else {
            field.lost += carried;
        }
    }
    for cell in 0..env.mesh.len() {
        field.origins[context.origin].stocks[stock].add(env.ground, cell, moved.get(cell)?)?;
    }
    Ok(())
}
fn recharge(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    origin: usize,
    stocks: [usize; 2],
    cell: usize,
    share: f64,
) -> io::Result<()> {
    if share == 0.0 {
        return Ok(());
    }
    let [water, brine] = stocks;
    let recharge = env.water.groundwater.recharge.get(cell)?;
    let brine = &mut field.origins[origin].stocks[brine];
    let infiltrated = returned_charge(
        brine.get(env.ground, cell)?,
        env.water.column.store(Store::Soil).held(cell)? + recharge,
        recharge,
    ) * share;
    brine.add(env.ground, cell, -infiltrated)?;
    field.origins[origin].stocks[water].add(env.ground, cell, infiltrated)
}
