use super::{
    grains::{self, Hop},
    Transport,
};
use crate::{
    climate::aligned_neighbor,
    field::shared::Scalar as F,
    magic::{
        carriers::passage,
        channels::Channel as C,
        inventory::{exposure, host_fraction, Inventory},
        sources::{Context, Environment},
        state::MagicField,
    },
    rock::load::MaterialLoad,
    scale::{LengthUnit, MapScale},
    settlement::removal::Facet,
    storage::Coverage,
};
use std::io;
pub fn seep_brine(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    coverage: &mut Coverage,
    cost: Option<&crate::storage::ReadBand<f64>>,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let bed = field.stock_index(context.origin, "bed");
    let mut moved = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        let brine = &mut field.origins[context.origin].stocks[stock];
        let held = brine.get(env.ground, cell)?;
        if held <= 0.0 {
            continue;
        }
        let anoxic = (env.scalar(F::WetlandCover, cell)? + env.scalar(F::PeatCarbon, cell)? / 20.0)
            .clamp(0.0, 1.0);
        let flushed =
            held * p.brine_flush * env.scalar(F::Moisture, cell)? / 1000.0 * (1.0 - anoxic);
        brine.add(env.ground, cell, -flushed)?;
        field.lost += flushed;
        let target = env.water.routing.targets.get(cell)?;
        if target < 0
            || env.water.column.kind.get(cell)? == 2
            || env.scalar(F::Warding, target as usize)? >= 0.5
        {
            let crust = brine.get(env.ground, cell)? * p.crust_share;
            brine.add(env.ground, cell, -crust)?;
            if let Some(bed) = bed {
                field.origins[context.origin].stocks[bed].deposit_salt(
                    env.ground,
                    cell,
                    crust,
                    env.mesh.area(cell),
                    p.salt_material_density,
                )?;
            }
            continue;
        }
        let target = target as usize;
        let share = brine.get(env.ground, cell)? * p.seep_share * passage(env, cost, target)?;
        brine.add(env.ground, cell, -share)?;
        if env.water.column.kind.get(target)? == 1 {
            field.lost += share;
        } else {
            moved.set(target, moved.get(target)? + share)?;
        }
    }
    for cell in 0..env.mesh.len() {
        field.origins[context.origin].stocks[stock].add(env.ground, cell, moved.get(cell)?)?;
    }
    Ok(())
}
pub fn weather_bed(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    transport: &mut Transport<'_>,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let mut cargo = MaterialLoad::new(transport.coverage);
    for cell in 0..env.mesh.len() {
        let bed = &field.origins[context.origin].stocks[stock];
        let held = bed.get(env.ground, cell)?;
        if held <= 0.0 {
            continue;
        }
        let exposed = match bed {
            Inventory::Ground(key) => {
                env.ground
                    .inventory_reached(*key, cell, MapScale::native(p.bury_depth))?
                    / held
            }
            Inventory::Mobile(_) => exposure(env.ground, cell, p.bury_depth, Some(&[4]))?,
        };
        if env.water.column.kind.get(cell)? == 1 {
            field.lost += grains::dissolve(
                env,
                field,
                context.origin,
                stock,
                cell,
                [
                    held * exposed * p.dissolve_share,
                    MapScale::native(p.bury_depth),
                ],
            )?;
        } else if exposed > 0.0 {
            weather_exposed(
                env,
                field,
                BedCell {
                    context,
                    stock,
                    cell,
                    exposed,
                },
                &mut cargo,
                transport,
            )?;
        } else if env.scalar(F::TectonicStrain, cell)? >= p.dome_strain {
            dome(env, field, context, stock, cell)?;
        }
    }
    grains::deposit(env, &cargo)
}
struct BedCell {
    context: Context,
    stock: usize,
    cell: usize,
    exposed: f64,
}
fn weather_exposed(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    bed: BedCell,
    cargo: &mut MaterialLoad,
    transport: &mut Transport<'_>,
) -> io::Result<()> {
    let BedCell {
        context,
        stock,
        cell,
        exposed,
    } = bed;
    let p = field.origin_parameters(context.origin);
    if env.scalar(F::Moisture, cell)? > 500.0 && env.water.column.kind.get(cell)? == 0 {
        if let Some(brine) = field.stock_index(context.origin, "brine") {
            let held = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
            let amount =
                held * exposed * p.dissolve_share * env.scalar(F::Moisture, cell)? / 1000.0;
            let dissolved = grains::dissolve(
                env,
                field,
                context.origin,
                stock,
                cell,
                [amount, MapScale::native(p.bury_depth)],
            )?;
            if dissolved > 0.0 {
                field.origins[context.origin].stocks[brine].add(env.ground, cell, dissolved)?;
                let drop = dissolved / (env.mesh.area(cell) * p.salt_material_density);
                let before = field.channels.band(C::Subsided).get(cell)?;
                field
                    .channels
                    .band_mut(C::Subsided)
                    .set(cell, before + drop)?;
            }
        }
    }
    let wind = [env.scalar(F::WindX, cell)?, env.scalar(F::WindY, cell)?];
    let bare = 1.0
        - (env.scalar(F::TreeCover, cell)?
            + env.scalar(F::GrassCover, cell)?
            + env.scalar(F::WetlandCover, cell)?)
        .clamp(0.0, 1.0);
    let lifted = field.origins[context.origin].stocks[stock].get(env.ground, cell)?
        * exposed
        * p.dust_share
        * (wind[0].hypot(wind[1]) / 1000.0).min(1.0)
        * bare;
    if lifted <= 0.0 {
        return Ok(());
    }
    let Some(target) = aligned_neighbor(env.mesh, cell, [wind[0] / 1000.0, wind[1] / 1000.0])
    else {
        return Ok(());
    };
    grains::move_grains(
        env,
        field,
        cargo,
        transport,
        Hop {
            origin: context.origin,
            stock,
            destination: field.stock_index(context.origin, "dust"),
            cell,
            target,
            amount: lifted,
            loose_only: false,
        },
    )
}
fn dome(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    cell: usize,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let mut depth = 0.0;
    for facet in Facet::ALL {
        for layer in env.ground.section(cell, facet)? {
            depth += (layer.material.depth - f64::from(layer.basement)).max(0.0)
                * layer.share
                * host_fraction(&layer.material, &[4]);
        }
    }
    let retained =
        MapScale::metres(depth, LengthUnit::Native) * env.mesh.area(cell) * p.salt_material_density;
    if retained <= 0.0 {
        return Ok(());
    }
    let held = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
    let rise = p.dome_rise * (held.min(retained) / (env.mesh.area(cell) * p.salt_full)).min(1.0);
    if rise > 0.0 {
        let before = field.channels.band(C::Domed).get(cell)?;
        field.channels.band_mut(C::Domed).set(cell, before + rise)?;
        env.ground.displace(cell, MapScale::native(rise), "salt")?;
    }
    let Some(brine) = field.stock_index(context.origin, "brine") else {
        return Ok(());
    };
    let mut ring = Vec::new();
    for edge in 0..3 {
        if let Some(next) = env.mesh.neighbor(cell, edge) {
            if env.water.column.kind.get(next)? == 0 {
                ring.push(next);
            }
        }
    }
    if ring.is_empty() {
        return Ok(());
    }
    let seep = grains::dissolve(
        env,
        field,
        context.origin,
        stock,
        cell,
        [held * p.dome_seep, f64::INFINITY],
    )?;
    let amount = seep / ring.len() as f64;
    for next in ring {
        field.origins[context.origin].stocks[brine].add(env.ground, next, amount)?;
    }
    Ok(())
}
pub fn settle_dust(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    transport: &mut Transport<'_>,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let bed = field.stock_index(context.origin, "bed");
    let mut cargo = MaterialLoad::new(transport.coverage);
    for cell in 0..env.mesh.len() {
        let held = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
        if held <= 0.0 {
            continue;
        }
        if let Some(bed) = bed {
            if let (Inventory::Ground(from), Inventory::Ground(to)) = (
                &field.origins[context.origin].stocks[stock],
                &field.origins[context.origin].stocks[bed],
            ) {
                env.ground
                    .inventory_transfer(*from, cell, held * p.dust_settle, *to)?;
            }
        }
        let wind = [
            env.scalar(F::WindX, cell)? / 1000.0,
            env.scalar(F::WindY, cell)? / 1000.0,
        ];
        let Some(target) = aligned_neighbor(env.mesh, cell, wind) else {
            continue;
        };
        let blown = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
        grains::move_grains(
            env,
            field,
            &mut cargo,
            transport,
            Hop {
                origin: context.origin,
                stock,
                destination: Some(stock),
                cell,
                target,
                amount: blown,
                loose_only: true,
            },
        )?;
    }
    grains::deposit(env, &cargo)
}
