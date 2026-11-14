use crate::{
    field::shared::Scalar as F,
    magic::{
        carriers::passage,
        inventory::exposure,
        sources::{Context, Environment},
        state::MagicField,
    },
    storage::{Coverage, ReadBand},
    water::network::{RiverReader, RiverTerrain},
};
use std::io;
pub fn carry_in_gut(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let herd =
        |cell| Ok::<_, io::Error>(env.scalar(F::Grazers, cell)? + env.scalar(F::Browsers, cell)?);
    let mut moved = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        let value = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
        let own = herd(cell)?;
        if value <= 0.0 || own <= 0.0 {
            continue;
        }
        let mut neighbors = Vec::new();
        let mut weight = 0.0;
        for edge in 0..3 {
            if let Some(next) = env.mesh.neighbor(cell, edge) {
                if env.water.column.kind.get(next)? == 0 {
                    neighbors.push(next);
                    weight += herd(next)?;
                }
            }
        }
        if weight <= 0.0 {
            continue;
        }
        let share = value * p.animal_carry * (own / 1000.0).clamp(0.0, 1.0);
        for next in neighbors {
            moved.set(next, moved.get(next)? + share * herd(next)? / weight)?;
        }
        moved.set(cell, moved.get(cell)? - share)?;
    }
    for cell in 0..env.mesh.len() {
        field.origins[context.origin].stocks[stock].add(env.ground, cell, moved.get(cell)?)?;
    }
    Ok(())
}
pub struct RiverPassage<'a> {
    pub rivers: &'a RiverReader<'a>,
    pub cost: Option<&'a ReadBand<f64>>,
}
pub fn carry_downstream(
    env: &mut Environment<'_>,
    field: &mut MagicField,
    context: Context,
    stock: usize,
    coverage: &mut Coverage,
    routing: RiverPassage<'_>,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    let mut moved = coverage.scratch(env.mesh.len(), 0.0);
    let terrain = RiverTerrain {
        mesh: env.mesh,
        water_kind: &env.water.column.kind,
        targets: &env.water.routing.targets,
    };
    for cell in 0..env.mesh.len() {
        let value = field.origins[context.origin].stocks[stock].get(env.ground, cell)?;
        let kind = env.water.column.kind.get(cell)?;
        if value <= 0.0 || kind == 1 {
            continue;
        }
        let on_river = routing.rivers.order_at(cell, kind) > 0;
        let target = if on_river {
            routing.rivers.successor(cell, None, &terrain)?
        } else {
            usize::try_from(env.water.routing.targets.get(cell)?).ok()
        };
        let Some(target) = target else {
            continue;
        };
        let share = value
            * exposure(env.ground, cell, p.bury_depth, None)?
            * p.placer_mobility
            * if on_river { 1.0 } else { 0.25 }
            * passage(env, routing.cost, target)?;
        if share <= 0.0 {
            continue;
        }
        field.origins[context.origin].stocks[stock].add(env.ground, cell, -share)?;
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
