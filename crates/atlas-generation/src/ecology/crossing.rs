use super::{environment::wind_strength, groups::Carrier, Habitat};
use crate::{
    field::shared::Scalar as S,
    hpc::{Direction, KeyedHeap},
    storage::{Band, Coverage},
};
use std::io;
fn water_step(
    map: &Habitat<'_>,
    carrier: Carrier,
    cell: usize,
    edge: usize,
    other: usize,
) -> io::Result<f64> {
    if map.water.column.kind.get(cell)? != 1 && map.water.column.kind.get(other)? != 1 {
        return Ok(0.0);
    }
    let (x, y, strength) = match carrier {
        Carrier::Wind => (
            map.get(S::WindX, cell)?,
            map.get(S::WindY, cell)?,
            wind_strength(map, cell)?,
        ),
        Carrier::Current => (
            map.get(S::OceanCurrentX, cell)?,
            map.get(S::OceanCurrentY, cell)?,
            2.0 * map.get(S::OceanCurrentStrength, cell)? / 1000.0,
        ),
    };
    let direction = map.mesh.edge_direction(cell, edge);
    let alignment = (direction[0] * x + direction[1] * y) / 1000.0;
    Ok(map.mesh.edge_length(cell, edge) / (1.0 + alignment * strength).max(0.2))
}
pub fn water_distance(
    map: &Habitat<'_>,
    occupied: impl Fn(usize) -> io::Result<bool>,
    carrier: Carrier,
    limit: f64,
    coverage: &mut Coverage,
) -> io::Result<Band<f64>> {
    let mut distance = coverage.scratch(map.mesh.len(), f64::INFINITY);
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for cell in 0..map.mesh.len() {
        if map.water.column.kind.get(cell)? != 1 && occupied(cell)? {
            distance.set(cell, 0.0)?;
            queue.push(cell as u32, [0.0]);
        }
    }
    traverse(map, &mut distance, &mut queue, carrier, limit)?;
    for cell in 0..map.mesh.len() {
        if map.water.column.kind.get(cell)? == 1 || distance.get(cell)? == 0.0 {
            distance.set(cell, f64::INFINITY)?;
        }
    }
    Ok(distance)
}
fn traverse(
    map: &Habitat<'_>,
    distance: &mut Band<f64>,
    queue: &mut KeyedHeap,
    carrier: Carrier,
    limit: f64,
) -> io::Result<()> {
    while let Some((cell, [d])) = queue.pop() {
        let cell = cell as usize;
        if d != distance.get(cell)? {
            continue;
        }
        for edge in 0..3 {
            let Some(other) = map.mesh.neighbor(cell, edge) else {
                continue;
            };
            let next = d + water_step(map, carrier, cell, edge, other)?;
            if next > limit || next >= distance.get(other)? {
                continue;
            }
            distance.set(other, next)?;
            queue.push(other as u32, [next]);
        }
    }
    Ok(())
}
pub fn crossing_time(interval: f64, reach: f64, distance: f64) -> f64 {
    interval * (distance / reach).exp()
}
