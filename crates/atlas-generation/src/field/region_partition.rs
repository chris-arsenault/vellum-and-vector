use super::{
    region_evidence::{region_evidence, Evidence},
    shared::Scalar,
    significance::{large_domain, measure, LANDSCAPE_MINIMUM_BREADTH},
    Field,
};
use crate::{
    hpc::{Direction, KeyedHeap},
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
    storage::Band,
};
use std::io;
const BASIN_CROSSING_COST: f64 = 2.0;
const TERRAIN_RISE_SCALE: f64 = 600.0;
const CLIMATE_TRANSITION_SCALE: f64 = 60.0;
const PROVINCE_MINIMUM_SHARE: f64 = 0.18;
pub fn land_area(field: &Field) -> io::Result<f64> {
    let water = field.water();
    let mut area = 0.0;
    for cell in 0..field.mesh.len() {
        if water.column.kind.get(cell)? == 0 {
            area += field.mesh.area(cell);
        }
    }
    Ok(area)
}
fn crossing_cost(field: &Field, a: usize, b: usize, length: f64) -> io::Result<f64> {
    let basins = field.water().routing.basins;
    let basin = basins.get(a)?;
    let other = basins.get(b)?;
    let divide = if basin > 0 && other > 0 && basin != other {
        BASIN_CROSSING_COST
    } else {
        0.0
    };
    let elevation = field.ground().view(GroundField::Elevation);
    let temperature = field.shared.scalar(Scalar::Temperature);
    let rise = MapScale::metres(
        (elevation.get(a)? - elevation.get(b)?).abs(),
        LengthUnit::Native,
    );
    let climate = (temperature.get(a)? - temperature.get(b)?).abs();
    Ok(length * (1.0 + divide + rise / TERRAIN_RISE_SCALE + climate / CLIMATE_TRANSITION_SCALE))
}
fn distances(
    field: &Field,
    members: &[usize],
    seeds: &[usize],
) -> io::Result<(Band<f64>, Band<i32>)> {
    let mut distance = field.coverage.borrow_mut().allocate(-1.0);
    let mut owner = field.coverage.borrow_mut().allocate(-1);
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for &cell in members {
        distance.set(cell, f64::INFINITY)?;
    }
    for (at, &cell) in seeds.iter().enumerate() {
        distance.set(cell, 0.0)?;
        owner.set(cell, at as i32)?;
        queue.push(cell as u32, [0.0]);
    }
    while let Some((cell, [d])) = queue.pop() {
        let cell = cell as usize;
        if distance.get(cell)? != d {
            continue;
        }
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if distance.get(next)? < 0.0 {
                continue;
            }
            let cost = d + crossing_cost(field, cell, next, field.mesh.edge_length(cell, edge))?;
            if cost >= distance.get(next)? {
                continue;
            }
            distance.set(next, cost)?;
            owner.set(next, owner.get(cell)?)?;
            queue.push(next as u32, [cost]);
        }
    }
    Ok((distance, owner))
}
fn distant(field: &Field, members: &[usize], start: usize) -> io::Result<usize> {
    let (distance, _) = distances(field, members, &[start])?;
    let mut far = start;
    for &cell in members {
        if distance.get(cell)? > distance.get(far)? {
            far = cell;
        }
    }
    Ok(far)
}
fn credible(field: &Field, pieces: &[Vec<usize>; 2], evidence: &Evidence) -> io::Result<bool> {
    for piece in pieces {
        if piece.is_empty() {
            return Ok(false);
        }
        let e = region_evidence(field, piece, |_| Ok(1.0), |_| true)?;
        if e.area < evidence.area * PROVINCE_MINIMUM_SHARE
            || e.breadth < measure(&field.scale, LANDSCAPE_MINIMUM_BREADTH, 1, 1.0)?
        {
            return Ok(false);
        }
    }
    Ok(true)
}
/// The caller records the existing subdivision warning for each retained continental domain.
pub fn partition(
    field: &Field,
    members: &[usize],
    land: f64,
    mut retained: impl FnMut(),
) -> io::Result<Vec<Vec<usize>>> {
    let mut pending = vec![members.to_vec()];
    let mut result = Vec::new();
    while let Some(current) = pending.pop() {
        let evidence = region_evidence(field, &current, |_| Ok(1.0), |_| true)?;
        if !large_domain(evidence.area, evidence.span, land, &field.scale)? {
            result.push(current);
            continue;
        }
        let a = distant(field, &current, current[0])?;
        let b = distant(field, &current, a)?;
        let (_, owner) = distances(field, &current, &[a, b])?;
        let mut pieces = [Vec::new(), Vec::new()];
        for &cell in &current {
            match owner.get(cell)? {
                0 => pieces[0].push(cell),
                1 => pieces[1].push(cell),
                _ => {}
            }
        }
        if credible(field, &pieces, &evidence)? {
            pending.extend(pieces);
        } else {
            result.push(current);
            retained();
        }
    }
    Ok(result)
}
