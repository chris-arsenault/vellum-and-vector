use super::{surface::Surface, Settings};
use crate::{
    field::{shared::Scalar as S, Field},
    metric::search::physical_distance,
    processes::runner::PhysicalContext,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::Band,
};
use std::{collections::VecDeque, io};
fn length(field: &Field, fraction: f64) -> io::Result<f64> {
    Ok(field
        .scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
fn balance(field: &Field, surface: &Surface, p: &Settings, cell: usize) -> io::Result<f64> {
    let read = |key| field.shared.scalar(key).get(cell);
    let cold = (p.ice_temperature_threshold - read(S::Temperature)?).max(0.0);
    let snow = (read(S::Snowfall)? * cold
        / MapScale::in_units(length(field, 7.5e-8)?, LengthUnit::Millimetre))
    .trunc();
    let altitude = (MapScale::metres(
        (surface.support(cell)? - field.water().effective_sea_level).max(0.0),
        LengthUnit::Native,
    )
    .round()
        * p.ice_altitude_balance)
        .trunc();
    let mut curvature = 0.0;
    for edge in 0..3 {
        if let Some(next) = field.mesh.neighbor(cell, edge) {
            curvature += MapScale::metres(
                surface.support(next)? - surface.support(cell)?,
                LengthUnit::Native,
            ) * field.mesh.face_length(cell, edge)
                / field.mesh.edge_length(cell, edge);
        }
    }
    let hollow = (curvature / field.mesh.area(cell)).max(0.0) * length(field, 12.5)?;
    Ok(cold * 2.0 + snow + altitude + hollow
        - (read(S::Temperature)? - p.ice_temperature_threshold).max(0.0) * 4.0
        - (read(S::Geothermal)? / 3.0).trunc()
        - (280.0 - read(S::Moisture)?).max(0.0))
}
fn edges(field: &mut Field, cutoff: f64) -> io::Result<Band<f64>> {
    let mut distance = field
        .coverage
        .get_mut()
        .scratch(field.mesh.len(), f64::INFINITY);
    let water = field.water().column.kind;
    let balance = field.shared.scalar(S::IceBalance);
    let mut seeds = Vec::new();
    for cell in 0..field.mesh.len() {
        if water.get(cell)? == 0
            && balance.get(cell)? >= cutoff
            && (0..3).all(|edge| field.mesh.neighbor(cell, edge).is_some())
        {
            continue;
        }
        distance.set(cell, 0.0)?;
        seeds.push(cell);
    }
    physical_distance(&field.mesh, seeds, &mut distance, f64::INFINITY, |_, _| {
        Ok(())
    })?;
    Ok(distance)
}
fn dry_land(field: &mut Field, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
    let distance = edges(field, p.minimum_ice_balance)?;
    let water = field.water().column.kind;
    for cell in 0..field.mesh.len() {
        if water.get(cell)? != 0 {
            continue;
        }
        let balance = field.shared.scalar(S::IceBalance).get(cell)?;
        let before = field.shared.scalar(S::IceThickness).get(cell)?;
        let gained = (balance - p.minimum_ice_balance)
            * length(field, 0.0000005)?
            * c.span
            * c.glaciation_strength
            / 1000.0;
        let stands = p.ice_yield_height * (distance.get(cell)? + field.scale.cells(0.5)).sqrt();
        let next = if balance >= p.minimum_ice_balance {
            (before + gained).min(stands.max(before))
        } else {
            let deficit = p.minimum_ice_balance - balance;
            let skin = length(field, 0.0000375)?;
            let held = field.shared.scalar(S::IcePersistence).get(cell)?
                * (1.0 - deficit / 600.0).max(0.0)
                * ((before - skin) / skin).clamp(0.0, 1.0);
            (before - length(field, 0.00000025)? * deficit * c.span * (1.0 - held)).max(0.0)
        };
        field.set_ice_response(cell, next.trunc(), "glaciers")?;
        let after = field.shared.scalar(S::IceThickness).get(cell)?;
        field.shared.scalar_mut(S::IceRetreat).set(
            cell,
            if c.span > 0.0 {
                (before - after).max(0.0) / c.span
            } else {
                0.0
            },
        )?;
        let maximum = field.shared.scalar_mut(S::MaximumIceThickness);
        maximum.set(cell, maximum.get(cell)?.max(after))?;
    }
    Ok(())
}
fn advance(
    field: &mut Field,
    p: &Settings,
    c: &PhysicalContext,
    source: usize,
    reached: &mut Band<u8>,
    queue: &mut VecDeque<usize>,
) -> io::Result<()> {
    let water = field.water().column.kind;
    for edge in 0..3 {
        let Some(target) = field.mesh.neighbor(source, edge) else {
            continue;
        };
        if water.get(target)? != 2
            || c.glaciation_strength <= 0.0
            || field.shared.scalar(S::Temperature).get(target)? > p.ice_temperature_threshold
            || field.shared.scalar(S::IceBalance).get(target)? < p.minimum_ice_balance
        {
            continue;
        }
        let candidate = (field.shared.scalar(S::IceThickness).get(source)?
            - p.frozen_lake_ice_advance_gradient * field.mesh.edge_length(source, edge))
        .max(0.0);
        let improved = candidate > field.shared.scalar(S::IceThickness).get(target)?;
        if improved {
            field
                .shared
                .scalar_mut(S::IceThickness)
                .set(target, candidate)?;
        }
        if reached.get(target)? == 0 || improved {
            reached.set(target, 1)?;
            queue.push_back(target);
        }
    }
    Ok(())
}
fn lakes(field: &mut Field, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
    let water = field.water().column.kind;
    let mut reached = field.coverage.get_mut().scratch(field.mesh.len(), 0u8);
    let mut queue = VecDeque::new();
    for cell in 0..field.mesh.len() {
        let ice = field.shared.scalar(S::IceThickness).get(cell)?;
        if water.get(cell)? == 2 {
            let next = (ice
                - p.ice_ablation_step
                    * c.span
                    * (1.0 - field.shared.scalar(S::IcePersistence).get(cell)?))
            .max(0.0);
            field.set_ice_response(cell, next, "glaciers")?;
        } else if water.get(cell)? == 0 && ice > 0.0 {
            reached.set(cell, 1)?;
            queue.push_back(cell);
        }
    }
    while let Some(cell) = queue.pop_front() {
        advance(field, p, c, cell, &mut reached, &mut queue)?;
    }
    for cell in 0..field.mesh.len() {
        if water.get(cell)? != 2 {
            continue;
        }
        let ice = field.shared.scalar(S::IceThickness).get(cell)?;
        let maximum = field.shared.scalar_mut(S::MaximumIceThickness);
        maximum.set(cell, maximum.get(cell)?.max(ice))?;
    }
    Ok(())
}
pub(super) fn run(field: &mut Field, p: &Settings, c: &PhysicalContext) -> io::Result<()> {
    for cell in 0..field.mesh.len() {
        field.shared.scalar_mut(S::IceBalance).set(cell, 0.0)?;
    }
    let surface = Surface::new(&field.ground(), &field.shared, &field.water());
    let mut land = 0;
    for cell in 0..field.mesh.len() {
        if !surface.carries(cell)? {
            continue;
        }
        let value = balance(field, &surface, p, cell)?;
        field.shared.scalar_mut(S::IceBalance).set(cell, value)?;
        if field.water().column.kind.get(cell)? == 0 {
            land += 1;
        }
    }
    if land > 0 {
        dry_land(field, p, c)?;
    }
    lakes(field, p, c)
}
