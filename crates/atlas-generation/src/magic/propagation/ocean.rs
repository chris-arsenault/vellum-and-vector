use super::beams::{trace, Ray};
use crate::{
    chance::Chance,
    hpc::{radix_order, BitSet, Direction, KeyedHeap, NumericKey},
    lattice::TriangularLattice,
    magic::{
        channels::Channel as C,
        sources::{Context, Environment},
        state::MagicField,
    },
    scale::{LengthUnit, RelativeMeasure},
    storage::{Band, Coverage, ReadBand},
    tectonics::sources::{area_budget, world_candidates},
    water::WaterView,
};
use std::io;
fn measure(env: &Environment<'_>, fraction: f64, dimension: i32) -> io::Result<f64> {
    Ok(env
        .scale
        .resolve(
            RelativeMeasure::new(fraction, dimension, 1.0, LengthUnit::Metre)
                .map_err(io::Error::other)?,
        )
        .map_err(io::Error::other)?
        .value())
}
pub fn coastline_length(env: &Environment<'_>) -> io::Result<f64> {
    let mut length = 0.0;
    for cell in 0..env.mesh.len() {
        if env.water.column.kind.get(cell)? != 1 {
            continue;
        }
        for edge in 0..3 {
            if let Some(next) = env.mesh.neighbor(cell, edge) {
                if env.water.column.kind.get(next)? != 1 {
                    length += env.mesh.face_length(cell, edge);
                }
            }
        }
    }
    Ok(length)
}
pub fn ocean_area(env: &Environment<'_>) -> io::Result<f64> {
    let mut area = 0.0;
    for cell in 0..env.mesh.len() {
        if env.water.column.kind.get(cell)? == 1 {
            area += env.mesh.area(cell);
        }
    }
    Ok(area)
}
fn coastal(mesh: &TriangularLattice, water: &WaterView, cell: usize) -> io::Result<bool> {
    if water.column.kind.get(cell)? != 1 {
        return Ok(false);
    }
    for edge in 0..3 {
        if let Some(next) = mesh.neighbor(cell, edge) {
            if water.column.kind.get(next)? != 1 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
pub fn coast_distances(
    env: &Environment<'_>,
    reach: f64,
    coverage: &mut Coverage,
) -> io::Result<Band<f64>> {
    coast_distances_on(env.mesh, env.water, reach, coverage)
}
pub fn coast_distances_on(
    mesh: &TriangularLattice,
    water: &WaterView,
    reach: f64,
    coverage: &mut Coverage,
) -> io::Result<Band<f64>> {
    let mut distances = coverage.scratch(mesh.len(), f64::INFINITY);
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for cell in 0..mesh.len() {
        if !coastal(mesh, water, cell)? {
            continue;
        }
        let start = mesh.cell_width().min(mesh.cell_height()) / 2.0;
        distances.set(cell, start)?;
        queue.push(cell as u32, [start]);
    }
    while let Some((cell, [distance])) = queue.pop() {
        let cell = cell as usize;
        if distance != distances.get(cell)? {
            continue;
        }
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            let distance = distance + mesh.edge_length(cell, edge);
            if water.column.kind.get(next)? != 1
                || distance > reach
                || distance >= distances.get(next)?
            {
                continue;
            }
            distances.set(next, distance)?;
            queue.push(next as u32, [distance]);
        }
    }
    Ok(distances)
}
fn sources(
    env: &Environment<'_>,
    count: usize,
    seed: i32,
    coastal: Option<f64>,
    coverage: &mut Coverage,
) -> io::Result<Vec<usize>> {
    if count == 0 {
        return Ok(vec![]);
    }
    let distances = coastal
        .map(|reach| coast_distances(env, reach, coverage))
        .transpose()?;
    let mut cells = Vec::new();
    let mut priorities = Vec::new();
    let samples = count
        .checked_mul(16)
        .ok_or_else(|| io::Error::other("Ocean candidate count exceeds address space"))?
        .max(256);
    for candidate in world_candidates(env.mesh, seed, samples) {
        let Some(cell) = env
            .mesh
            .cell_at(candidate.position[0], candidate.position[1])
        else {
            continue;
        };
        if env.water.column.kind.get(cell)? != 1 {
            continue;
        }
        if let (Some(distances), Some(reach)) = (&distances, coastal) {
            if distances.get(cell)? > reach {
                continue;
            }
        }
        cells.push(cell);
        priorities.push(candidate.priority);
    }
    let mut taken = BitSet::new(env.mesh.len());
    let mut selected = Vec::new();
    for index in radix_order(&[NumericKey::Float(&priorities)], Direction::Descending)
        .map_err(io::Error::other)?
    {
        let cell = cells[index];
        if taken.has(cell) || selected.len() >= count {
            continue;
        }
        taken.add(cell);
        selected.push(cell);
    }
    Ok(selected)
}
pub fn propagate(
    env: &Environment<'_>,
    field: &mut MagicField,
    context: Context,
    source: &ReadBand<f64>,
    seed: i32,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let p = field.origin_parameters(context.origin);
    for cell in 0..env.mesh.len() {
        let strength = source.get(cell)?;
        if strength == 0.0 || env.water.column.kind.get(cell)? != 1 {
            continue;
        }
        for ray in 0..p.ray_count.ceil() as usize {
            trace(
                env,
                field,
                &p,
                Ray {
                    seed: seed ^ ray as i32,
                    source: cell,
                    angle: ray as f64 * std::f64::consts::TAU / p.ray_count,
                    energy: (strength * context.activity + 0.5).floor(),
                    reach: p.ray_distance,
                    wake: false,
                },
            )?;
        }
    }
    let coastal = area_budget(
        p.coastal_sources,
        coastline_length(env)?,
        measure(env, 5.0, 1)?,
    );
    for (index, cell) in sources(
        env,
        coastal,
        seed,
        Some(p.coastal_source_distance),
        coverage,
    )?
    .into_iter()
    .enumerate()
    {
        field.channels.band_mut(C::Rogue).set(cell, 1.0)?;
        for ray in 0..24 {
            trace(
                env,
                field,
                &p,
                Ray {
                    seed: seed ^ (index as i32).wrapping_mul(397) ^ ray,
                    source: cell,
                    angle: ray as f64 * std::f64::consts::TAU / 24.0,
                    energy: (620.0 * context.activity).trunc(),
                    reach: p.coastal_ray_distance,
                    wake: false,
                },
            )?;
        }
    }
    let wakes = area_budget(p.wake_sources, ocean_area(env)?, measure(env, 0.39, 2)?);
    let length = measure(env, 0.0025, 1)?;
    for (index, cell) in sources(env, wakes, seed ^ 0x3359, None, coverage)?
        .into_iter()
        .enumerate()
    {
        let seed = seed ^ (index as i32).wrapping_mul(7919);
        trace(
            env,
            field,
            &p,
            Ray {
                seed,
                source: cell,
                angle: Chance::of(seed, 0)
                    .angle([(env.mesh.position(cell)[0] / length + 0.5).floor(), 0.0]),
                energy: p.wake_strength * context.activity,
                reach: p.wake_distance,
                wake: true,
            },
        )?;
    }
    Ok(())
}
