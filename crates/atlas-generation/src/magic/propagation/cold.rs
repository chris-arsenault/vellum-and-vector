use crate::{
    field::shared::Scalar as F,
    hpc::Direction,
    magic::{
        channels::Channel as C,
        sources::{Context, Environment},
        state::MagicField,
    },
    noise::hash_unit,
    storage::{Coverage, ReadBand},
};
use std::io;
pub struct Fallout<'a> {
    pub context: Context,
    pub seed: i32,
    pub source: &'a ReadBand<f64>,
    pub placed_cost: Option<&'a ReadBand<f64>>,
}
pub fn propagate(
    env: &Environment<'_>,
    field: &mut MagicField,
    fallout: Fallout<'_>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let p = field.origin_parameters(fallout.context.origin);
    let ice = first_ice(field);
    let mut accumulation = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        accumulation.set(
            cell,
            fallout.source.get(cell)? * fallout.context.activity * env.mesh.area(cell),
        )?;
    }
    for cell in coverage.order(&env.fields.scalar(F::Temperature), Direction::Descending)? {
        let cell = cell?;
        let target = cold_target(env, cell, fallout.seed)?;
        let capacity = env.scalar(F::IceThickness, cell)?.max(0.0);
        let area = env.mesh.area(cell);
        let source = fallout.source.get(cell)? * fallout.context.activity;
        let travel = match target {
            Some((_, edge)) => env.mesh.edge_length(cell, edge),
            None => area.sqrt(),
        };
        let capture = 1.0
            - (1.0 - (capacity / p.ice_retention).clamp(0.0, 1.0))
                .powf(travel / p.cold_retention_distance);
        let accumulated = accumulation.get(cell)?;
        let retained = accumulated * capture;
        let local = match ice {
            Some((origin, stock)) => field.origins[origin].stocks[stock].get(env.ground, cell)?,
            None => 0.0,
        };
        let incoming = (accumulated - source * area).max(0.0);
        let concentration = source + local / area + incoming / p.accumulation_area;
        let intensity = if concentration > 0.0 {
            (((concentration + 1.0).log2() * p.log_scale + 0.5).floor() + (capacity / 4.0).trunc())
                .clamp(0.0, 1000.0)
        } else {
            0.0
        };
        field.channels.band_mut(C::Intensity).set(cell, intensity)?;
        field.channels.band_mut(C::Retained).set(cell, retained)?;
        if let Some((target, _)) = target {
            let placed = match fallout.placed_cost {
                Some(cost) => cost.get(target)?,
                None => 1.0,
            };
            accumulation.set(
                target,
                accumulation.get(target)? + (accumulated - retained).max(0.0) / placed,
            )?;
        }
    }
    Ok(())
}
fn first_ice(field: &MagicField) -> Option<(usize, usize)> {
    field
        .definition
        .origins
        .iter()
        .enumerate()
        .find_map(|(i, origin)| {
            origin
                .stocks
                .iter()
                .position(|stock| stock.reservoir == "ice")
                .map(|j| (i, j))
        })
}
fn cold_target(
    env: &Environment<'_>,
    cell: usize,
    seed: i32,
) -> io::Result<Option<(usize, usize)>> {
    let here = env.scalar(F::Temperature, cell)?;
    let mut target = None;
    let mut lowest = 0.0;
    let mut tie = -1.0;
    for edge in 0..3 {
        let Some(next) = env.mesh.neighbor(cell, edge) else {
            continue;
        };
        let there = env.scalar(F::Temperature, next)?;
        if there >= here {
            continue;
        }
        let score = hash_unit(
            seed ^ 0x4dcb,
            env.mesh.identity(cell) as f64,
            env.mesh.identity(next) as f64,
        );
        let gradient = (there - here) / env.mesh.edge_length(cell, edge);
        if gradient < lowest || (gradient == lowest && score > tie) {
            target = Some((next, edge));
            lowest = gradient;
            tie = score;
        }
    }
    Ok(target)
}
