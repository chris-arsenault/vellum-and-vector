//! Lake stages use routed supply and the additional losses of open water over land.
use super::ledger::SECONDS_PER_YEAR;
use crate::{
    flow_graph::gather_down,
    hpc::{radix_order, Direction, NumericKey},
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

#[derive(Clone)]
pub struct Depression {
    pub id: i32,
    pub members: Vec<usize>,
    pub spill: f64,
}
pub struct SupportedLake {
    pub component: Depression,
    pub members: Vec<usize>,
    pub surface: f64,
    pub depth: f64,
    pub overflow: f64,
}
pub struct StageInputs<'a> {
    pub mesh: &'a TriangularLattice,
    pub elevation: &'a ReadBand<f64>,
    pub parents: &'a ReadBand<i32>,
    pub open_water_loss: &'a dyn Fn(usize) -> io::Result<f64>,
    pub infiltration_loss: f64,
}
pub struct LakeCriteria<'a> {
    pub minimum_area: f64,
    pub depth_threshold: f64,
    pub compactness_share: f64,
    pub dams: Option<&'a ReadBand<u8>>,
}
pub fn open_water_loss(
    demand: f64,
    rainfall: f64,
    snowfall: f64,
    runoff: f64,
    recharge: f64,
    snow_kept: f64,
) -> f64 {
    (demand - (rainfall + snowfall - runoff - recharge - snow_kept).max(0.0)).max(0.0)
}
pub fn depth_discharge(millimetres: f64, area: f64) -> f64 {
    millimetres / 1000.0 * area / SECONDS_PER_YEAR
}
pub fn contributing_water(
    mesh: &TriangularLattice,
    drainage: &super::drainage::DrainageView,
    supply: &ReadBand<f64>,
    incoming: Option<&ReadBand<f64>>,
    passage: impl FnMut(usize, f64) -> io::Result<f64>,
    coverage: &mut Coverage,
) -> io::Result<Band<f64>> {
    let count = mesh.len();
    let mut order = coverage.scratch(count, u32::MAX);
    let mut water = coverage.scratch(count, 0.0);
    for cell in 0..count {
        let rank = usize::try_from(drainage.ranks.get(cell)?).map_err(io::Error::other)?;
        if rank >= count || order.get(count - 1 - rank)? != u32::MAX {
            return Err(io::Error::other(
                "Priority-flood ranks are not a complete order",
            ));
        }
        order.set(count - 1 - rank, cell as u32)?;
        water.set(
            cell,
            depth_discharge(supply.get(cell)?, mesh.area(cell))
                + match incoming {
                    Some(incoming) => incoming.get(cell)?,
                    None => 0.0,
                },
        )?;
    }
    gather_down(&order.read_only(), &drainage.parents, &mut water, passage)?;
    Ok(water)
}
pub fn split_connected(
    mesh: &TriangularLattice,
    submerged: &[usize],
    coverage: &mut Coverage,
) -> io::Result<Vec<Vec<usize>>> {
    let mut remaining = coverage.scratch(mesh.len(), 0u8);
    let mut lobes = Vec::new();
    for &cell in submerged {
        remaining.set(cell, 1)?;
    }
    for &start in submerged {
        if remaining.get(start)? == 0 {
            continue;
        }
        remaining.set(start, 0)?;
        let mut members = vec![start];
        let mut head = 0;
        while head < members.len() {
            let cell = members[head];
            head += 1;
            for edge in 0..3 {
                let Some(next) = mesh.neighbor(cell, edge) else {
                    continue;
                };
                if remaining.get(next)? == 0 {
                    continue;
                }
                remaining.set(next, 0)?;
                members.push(next);
            }
        }
        members.sort_unstable();
        lobes.push(members);
    }
    Ok(lobes)
}
fn basin_cells(elevation: &ReadBand<f64>, component: &Depression) -> io::Result<Vec<usize>> {
    let keys: Vec<_> = component
        .members
        .iter()
        .map(|&cell| elevation.get(cell))
        .collect::<io::Result<_>>()?;
    let order =
        radix_order(&[NumericKey::Float(&keys)], Direction::Ascending).map_err(io::Error::other)?;
    Ok(order.into_iter().map(|at| component.members[at]).collect())
}
fn stage_budget(input: &StageInputs<'_>, cells: &[usize], supply: f64) -> io::Result<(f64, usize)> {
    let (mut loss, mut count, mut cursor) = (0.0, 0, 0);
    while cursor < cells.len() {
        let floor = input.elevation.get(cells[cursor])?;
        let (mut end, mut group_loss) = (cursor, 0.0);
        while end < cells.len() && input.elevation.get(cells[end])? == floor {
            let cell = cells[end];
            group_loss += depth_discharge(
                (input.open_water_loss)(cell)? + input.infiltration_loss,
                input.mesh.area(cell),
            );
            end += 1;
        }
        if loss + group_loss > supply.max(0.0) {
            break;
        }
        loss += group_loss;
        count = end;
        cursor = end;
    }
    Ok((loss, count))
}
pub fn lake_losses(input: &StageInputs<'_>, kind: &ReadBand<u8>) -> io::Result<(f64, f64)> {
    let (mut evaporation, mut seepage) = (0.0, 0.0);
    for cell in 0..input.mesh.len() {
        if kind.get(cell)? != 2 {
            continue;
        }
        evaporation += depth_discharge((input.open_water_loss)(cell)?, input.mesh.area(cell));
        seepage += depth_discharge(input.infiltration_loss, input.mesh.area(cell));
    }
    Ok((evaporation, seepage))
}
fn basin_input(
    input: &StageInputs<'_>,
    component: &Depression,
    water: &ReadBand<f64>,
    coverage: &mut Coverage,
) -> io::Result<f64> {
    let mut basin = coverage.scratch(input.mesh.len(), 0u8);
    for &cell in &component.members {
        basin.set(cell, 1)?;
    }
    let mut supply = 0.0;
    for &cell in &component.members {
        let target = input.parents.get(cell)?;
        if target < 0 || basin.get(target as usize)? == 0 {
            supply += water.get(cell)?;
        }
    }
    Ok(supply)
}
pub fn solve_stage(
    input: &StageInputs<'_>,
    component: Depression,
    water: &ReadBand<f64>,
    coverage: &mut Coverage,
) -> io::Result<Option<SupportedLake>> {
    if component.members.is_empty() {
        return Ok(None);
    }
    let cells = basin_cells(input.elevation, &component)?;
    let supply = basin_input(input, &component, water, coverage)?;
    let (loss, count) = stage_budget(input, &cells, supply)?;
    if count == 0 {
        return Ok(None);
    }
    let surface = if count == cells.len() {
        component.spill
    } else {
        component.spill.min(input.elevation.get(cells[count])?)
    };
    let mut members = Vec::new();
    let mut depth = 0.0f64;
    for &cell in &cells[..count] {
        let floor = input.elevation.get(cell)?;
        if floor < surface {
            members.push(cell);
            depth = depth.max(surface - floor);
        }
    }
    if members.is_empty() {
        return Ok(None);
    }
    members.sort_unstable();
    let overflow = if count == cells.len() {
        (supply - loss).max(0.0)
    } else {
        0.0
    };
    Ok(Some(SupportedLake {
        component,
        members,
        surface,
        depth,
        overflow,
    }))
}
fn touches_dam(
    mesh: &TriangularLattice,
    dams: &ReadBand<u8>,
    lake: &SupportedLake,
) -> io::Result<bool> {
    for &cell in &lake.members {
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                if dams.get(next)? != 0 {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}
fn compactness(
    mesh: &TriangularLattice,
    lake: &SupportedLake,
    coverage: &mut Coverage,
) -> io::Result<f64> {
    let mut set = coverage.scratch(mesh.len(), 0u8);
    for &cell in &lake.members {
        set.set(cell, 1)?;
    }
    let (mut interior, mut total) = (0.0, 0.0f64);
    for &cell in &lake.members {
        let mut supported = 0.0;
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                if set.get(next)? != 0 {
                    supported += mesh.face_length(cell, edge);
                }
            }
        }
        // The shared triangular lattice defines both cell width and height as its area span.
        let perimeter = 4.0 * mesh.cell_span();
        let area = mesh.area(cell);
        if supported >= perimeter / 2.0 {
            interior += area;
        }
        total += area;
    }
    Ok(interior * 1000.0 / total.max(1e-9))
}
pub fn qualifies(
    mesh: &TriangularLattice,
    criteria: &LakeCriteria<'_>,
    lake: &SupportedLake,
    coverage: &mut Coverage,
) -> io::Result<bool> {
    if let Some(dams) = criteria.dams {
        if touches_dam(mesh, dams, lake)? {
            return Ok(lake.depth > 0.0);
        }
    }
    let area: f64 = lake.members.iter().map(|&cell| mesh.area(cell)).sum();
    if area < criteria.minimum_area || lake.depth < criteria.depth_threshold {
        return Ok(false);
    }
    Ok(compactness(mesh, lake, coverage)? >= criteria.compactness_share)
}
