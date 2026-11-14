use super::Habitat;
use crate::{
    field::shared::Scalar as S,
    hpc::{Direction, KeyedHeap},
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
    water::column::Store,
};
use std::io;
pub struct Front {
    pub time: Band<f64>,
    pub source: Band<i32>,
}
pub fn front(
    mesh: &TriangularLattice,
    starts: &ReadBand<f64>,
    admits: impl Fn(usize) -> io::Result<bool>,
    travel: impl Fn(usize, usize, usize) -> io::Result<f64>,
    coverage: &mut Coverage,
) -> io::Result<Front> {
    let mut time = coverage.scratch(mesh.len(), f64::INFINITY);
    let mut source = coverage.scratch(mesh.len(), -1);
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for cell in 0..mesh.len() {
        let start = starts.get(cell)?;
        if start.is_finite() && admits(cell)? {
            time.set(cell, start)?;
            source.set(cell, cell as i32)?;
            queue.push(cell as u32, [start]);
        }
    }
    while let Some((cell, [at])) = queue.pop() {
        let cell = cell as usize;
        if at != time.get(cell)? {
            continue;
        }
        for edge in 0..3 {
            let Some(other) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if !admits(other)? {
                continue;
            }
            let next = at + travel(cell, edge, other)?;
            if next < time.get(other)? {
                time.set(other, next)?;
                source.set(other, source.get(cell)?)?;
                queue.push(other as u32, [next]);
            }
        }
    }
    Ok(Front { time, source })
}
pub struct Migration {
    pub years: f64,
    pub speed: f64,
    pub aquatic: bool,
}
pub fn migrate(
    map: &mut Habitat<'_>,
    population: S,
    capacity: &ReadBand<f64>,
    input: &Migration,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut starts = coverage.scratch(map.mesh.len(), f64::INFINITY);
    for cell in 0..map.mesh.len() {
        if capacity.get(cell)? > map.get(population, cell)? * 1.1 + 1e-8 {
            starts.set(cell, 0.0)?;
        }
    }
    let front = front(
        map.mesh,
        &starts.read_only(),
        |cell| {
            let kind = map.water.column.kind.get(cell)?;
            Ok(if input.aquatic {
                (kind > 0 || map.on_river(cell)?)
                    && map.get(S::IceThickness, cell)? < map.length(5e-7)?
            } else {
                kind != 1
                    && map.water.column.store(Store::Standing).held(cell)? < map.length(3.75e-7)?
            })
        },
        |cell, edge, other| {
            Ok(if input.speed > 0.0 {
                map.mesh.edge_length(cell, edge)
                    * (1.0
                        + map.get(S::Slope, other)? * 8.0
                        + map.get(S::EcologicalToxicity, other)? * 10.0
                        + map.get(S::IceThickness, other)? / map.length(0.000025)?)
                    / input.speed
            } else {
                f64::INFINITY
            })
        },
        coverage,
    )?;
    relocate(map, population, capacity, &front, input.years, coverage)
}
fn relocate(
    map: &mut Habitat<'_>,
    population: S,
    capacity: &ReadBand<f64>,
    front: &Front,
    years: f64,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut moving = coverage.scratch(map.mesh.len(), 0.0);
    for cell in 0..map.mesh.len() {
        let target = front.source.get(cell)?;
        let arrival = front.time.get(cell)?;
        if target < 0 || target as usize == cell || arrival > years {
            continue;
        }
        let target = target as usize;
        let excess = (map.get(population, cell)? - capacity.get(cell)?).max(0.0);
        let amount = excess * -(-years / arrival.max(0.01)).exp_m1();
        map.add(population, cell, -amount)?;
        moving.set(
            target,
            moving.get(target)? + amount * map.mesh.area(cell) / map.mesh.area(target),
        )?;
        map.add(S::MigrationFlux, cell, amount)?;
    }
    for cell in 0..map.mesh.len() {
        map.add(population, cell, moving.get(cell)?)?;
    }
    Ok(())
}
