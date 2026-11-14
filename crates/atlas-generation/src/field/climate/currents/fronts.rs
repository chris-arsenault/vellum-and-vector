use super::{
    super::{latitude, ocean, read, wrap, write},
    gyres::ocean_path,
    settings::Settings,
};
use crate::{
    field::{shared::Scalar as S, Field},
    flow_graph::source_order,
    metric::smoothing::smooth,
    processes::runner::PhysicalContext,
    storage::{Band, ReadBand},
};
use std::io;

fn carried(
    field: &Field,
    p: &Settings,
    c: &PhysicalContext,
    upstream: &ReadBand<i32>,
) -> io::Result<Band<f64>> {
    let mut coverage = field.coverage.borrow_mut();
    let mut sums = coverage.allocate(0.0);
    let mut weights = coverage.allocate(0.0);
    let mut carried = coverage.allocate(0.0);
    let sorted = source_order(&mut coverage, upstream)?;
    let edges = wrap::edges(field, &p.atmosphere);
    for pass in 0..2 {
        for at in 0..sorted.order.len() {
            let cell = sorted.order.get(at)? as usize;
            if !ocean(field, cell)? {
                continue;
            }
            let upwind = if sorted.boundary.get(cell)? != 0 && pass == 0 {
                -1
            } else {
                upstream.get(cell)?
            };
            let lat = latitude(field, &p.atmosphere, cell);
            let insolation = (-p.atmosphere.insolation_temperature_range
                * (3.0 * lat.to_radians().sin().powi(2) - 1.0)
                / 2.0)
                .round();
            let local = p.atmosphere.temperature_baseline + c.temperature_offset + insolation;
            let decay = if upwind < 0 || !ocean(field, upwind as usize)? {
                0.0
            } else {
                (-wrap::distance(field, edges, upwind as usize, cell) / p.sea_surface_relaxation)
                    .exp()
            };
            let sum = local
                + if decay != 0.0 {
                    decay * sums.get(upwind as usize)?
                } else {
                    0.0
                };
            let weight = 1.0
                + if decay != 0.0 {
                    decay * weights.get(upwind as usize)?
                } else {
                    0.0
                };
            sums.set(cell, sum)?;
            weights.set(cell, weight)?;
            carried.set(
                cell,
                (sum / weight - local)
                    * (read(field, S::OceanCurrentStrength, cell)? / 600.0).min(1.0),
            )?;
        }
    }
    Ok(carried)
}
fn opposition(field: &Field) -> io::Result<Band<f64>> {
    let mut result = field.coverage.borrow_mut().allocate(0.0f64);
    for cell in 0..field.mesh.len() {
        if !ocean(field, cell)? {
            continue;
        }
        let x = read(field, S::OceanCurrentX, cell)?;
        let y = read(field, S::OceanCurrentY, cell)?;
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if !ocean(field, next)? {
                continue;
            }
            let dot = (x * read(field, S::OceanCurrentX, next)?
                + y * read(field, S::OceanCurrentY, next)?)
                / 1e6;
            result.set(cell, result.get(cell)?.max(-dot))?;
        }
    }
    Ok(result)
}
fn mix(field: &Field, p: &Settings, carried: &mut Band<f64>) -> io::Result<()> {
    let opposing = opposition(field)?;
    let length = p.sea_surface_mixing;
    let reach = length * 3.0;
    let mut coverage = field.coverage.borrow_mut();
    let mut front = coverage.allocate(reach);
    let mut zone = coverage.allocate(0u8);
    for cell in 0..field.mesh.len() {
        if opposing.get(cell)? > 0.5 {
            front.set(cell, 0.0)?;
        }
    }
    ocean_path(field, &mut front, reach)?;
    let mut any = false;
    for cell in 0..field.mesh.len() {
        let included = ocean(field, cell)? && front.get(cell)? < reach;
        zone.set(cell, u8::from(included))?;
        any |= included;
    }
    if !any {
        return Ok(());
    }
    let mixed = smooth(
        &field.mesh,
        &mut coverage,
        &carried.read_only(),
        length,
        Some(&zone.read_only()),
    )?;
    for cell in 0..field.mesh.len() {
        let w = (-(front.get(cell)? / length).powi(2)).exp();
        let value = carried.get(cell)?;
        carried.set(cell, value + w * (mixed.get(cell)? - value))?;
    }
    Ok(())
}
pub(super) fn anomaly(
    field: &Field,
    p: &Settings,
    c: &PhysicalContext,
    upstream: &ReadBand<i32>,
) -> io::Result<()> {
    let mut carried = carried(field, p, c, upstream)?;
    mix(field, p, &mut carried)?;
    for cell in 0..field.mesh.len() {
        let value = if ocean(field, cell)? {
            (carried.get(cell)? - read(field, S::Upwelling, cell)? * p.upwelling_cooling / 1000.0)
                .round()
        } else {
            0.0
        };
        write(field, S::SeaSurfaceAnomaly, cell, value)?;
    }
    Ok(())
}
