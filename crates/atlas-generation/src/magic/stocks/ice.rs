use crate::{
    climate::aligned_neighbor,
    field::{
        shared::{CellCode, Scalar as F},
        surface_media::{self, melted_inventory, IceTransfer},
    },
    magic::{
        carriers::passage,
        inventory::Inventory,
        sources::{Context, Environment},
        state::MagicField,
    },
    rock::ground::InventoryConstruction,
    scale::MapScale,
    storage::{Coverage, ReadBand},
};
use std::io;
pub fn melt(
    env: &mut Environment<'_>,
    water: &mut crate::water::Water,
    fields: &mut [MagicField],
    input: &surface_media::Melt,
) -> io::Result<f64> {
    let receipt = surface_media::remove_ice(env.fields.material()?, input)?;
    if receipt.melted <= 0.0 {
        return Ok(0.0);
    }
    for field in fields {
        release_melt(env, field, input.cell, receipt.melted, receipt.before)?;
    }
    surface_media::record_melt(env.ground, water, env.mesh, input, &receipt)?;
    Ok(receipt.melted)
}
fn drop_charge(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    origin: usize,
    sinks: [Option<usize>; 2],
    cell: usize,
    amount: f64,
) -> io::Result<()> {
    let sink = sinks[usize::from(env.water.column.kind.get(cell)? == 1)];
    let Some(sink) = sink else {
        field.lost += amount;
        return Ok(());
    };
    match &mut field.origins[origin].stocks[sink] {
        Inventory::Ground(key) => env.ground.inventory_construct(
            *key,
            cell,
            InventoryConstruction {
                amount,
                depth: MapScale::native(amount / (env.mesh.area(cell) * 500.0)),
                kind: 18,
            },
            "ice debris",
        ),
        values => values.add(env.ground, cell, amount),
    }
}
pub fn release_melt(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    cell: usize,
    melted: f64,
    before: f64,
) -> io::Result<()> {
    for origin in 0..field.origins.len() {
        let p = field.origin_parameters(origin);
        let moraine = field.stock_index(origin, "moraine");
        for stock in 0..field.origins[origin].stocks.len() {
            let name = &field.definition.origins[origin].stocks[stock].reservoir;
            if name != "ice" && name != "shelf" {
                continue;
            }
            let values = &mut field.origins[origin].stocks[stock];
            let released = melted_inventory(values.get(env.ground, cell)?, melted, before);
            if released <= 0.0 {
                continue;
            }
            values.add(env.ground, cell, -released)?;
            if name == "shelf" || env.water.column.kind.get(cell)? == 1 {
                field.lost += released;
            } else {
                let lost = released * p.meltwater_loss;
                field.lost += lost;
                drop_charge(env, field, origin, [moraine, None], cell, released - lost)?;
            }
        }
    }
    Ok(())
}
pub fn carry(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    coverage: &mut Coverage,
    cost: Option<&ReadBand<f64>>,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let sinks = [
        field.stock_index(context.origin, "moraine"),
        field.stock_index(context.origin, "shelf"),
    ];
    let mut moved = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        let held = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
        if held <= 0.0 {
            continue;
        }
        if env.scalar(F::IceThickness, cell)? <= 0.0 || env.water.column.kind.get(cell)? == 1 {
            drop_charge(env, field, context.origin, sinks, cell, held)?;
            field.origins[context.origin].stocks[stock].set(env.ground, cell, 0.0)?;
            continue;
        }
        let Ok(target) = usize::try_from(env.fields.code(CellCode::IceFlowTargets).get(cell)?)
        else {
            continue;
        };
        let share = held * p.ice_carry * passage(env, cost, target)?;
        field.origins[context.origin].stocks[stock].set(env.ground, cell, held - share)?;
        if env.scalar(F::IceThickness, target)? > 0.0 && env.water.column.kind.get(target)? != 1 {
            moved.set(target, moved.get(target)? + share)?;
        } else {
            calve(env, cell, target, share / held)?;
            drop_charge(env, field, context.origin, sinks, target, share)?;
        }
    }
    for cell in 0..env.mesh.len() {
        let values = &mut field.origins[context.origin].stocks[stock];
        values.add(env.ground, cell, moved.get(cell)?)?;
        let held = values.get(env.ground, cell)?;
        let capacity =
            env.mesh.area(cell) * env.scalar(F::IceThickness, cell)? * p.ice_charge_saturation;
        env.fields.scalar_mut(F::IceCharge).set(
            cell,
            if held > 0.0 && capacity > 0.0 {
                (held / capacity).clamp(0.0, 1.0)
            } else {
                0.0
            },
        )?;
    }
    Ok(())
}
fn calve(env: &mut Environment<'_>, cell: usize, target: usize, share: f64) -> io::Result<()> {
    if env.water.column.kind.get(target)? == 1 {
        let volume = env.scalar(F::IceThickness, cell)? * share * env.mesh.area(cell);
        surface_media::transfer(
            env.fields.material()?,
            env.mesh,
            &IceTransfer {
                from: cell,
                to: target,
                volume,
            },
        )?;
    }
    Ok(())
}
pub fn carry_shelf(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let mut moved = coverage.scratch(env.mesh.len(), 0.0);
    let mut ice = coverage.scratch(env.mesh.len(), 0.0);
    let values = &mut field.origins[context.origin].stocks[stock];
    for cell in 0..env.mesh.len() {
        let held = values.get(env.ground, cell)?;
        if held <= 0.0 {
            continue;
        }
        let thickness = env.scalar(F::IceThickness, cell)?;
        if env.water.column.kind.get(cell)? != 1 || thickness <= 0.0 {
            values.set(env.ground, cell, 0.0)?;
            field.lost += held;
            continue;
        }
        let melt = held
            * p.meltwater_loss
            * ((env.scalar(F::Temperature, cell)? - 300.0).max(0.0) / 100.0).clamp(0.0, 1.0);
        let target = aligned_neighbor(
            env.mesh,
            cell,
            [
                env.scalar(F::OceanCurrentX, cell)?,
                env.scalar(F::OceanCurrentY, cell)?,
            ],
        );
        let share = if let Some(target) = target {
            if env.water.column.kind.get(target)? == 1 {
                (held - melt)
                    * p.ice_carry
                    * (env.scalar(F::OceanCurrentStrength, cell)? / 1000.0).clamp(0.0, 1.0)
            } else {
                0.0
            }
        } else {
            0.0
        };
        values.set(env.ground, cell, held - melt - share)?;
        field.lost += melt;
        let volume = thickness * env.mesh.area(cell);
        ice.set(cell, ice.get(cell)? - volume * (melt + share) / held)?;
        if let Some(target) = target.filter(|_| share > 0.0) {
            moved.set(target, moved.get(target)? + share)?;
            ice.set(target, ice.get(target)? + volume * share / held)?;
        }
    }
    for cell in 0..env.mesh.len() {
        values.add(env.ground, cell, moved.get(cell)?)?;
    }
    surface_media::redistribute(env.fields.material()?, env.mesh, &ice.read_only())
}
