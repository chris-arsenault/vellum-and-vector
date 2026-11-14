use super::{frame::Frame, Settings};
use crate::{
    field::{material::MaterialWork, shared::Scalar},
    hpc::BitSet,
    metric::search::search,
    rock::material::MaterialLayer,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::stage::Deposit,
    storage::Band,
};
use std::io;
struct Targets {
    cells: Vec<usize>,
    weights: Vec<f64>,
}
fn targets(
    work: &mut MaterialWork<'_>,
    frame: &Frame,
    source: usize,
    reach: f64,
    ocean_only: bool,
) -> io::Result<Targets> {
    let mut seen = BitSet::new(work.mesh.len());
    let mut visited = Vec::new();
    let mut distance = work.coverage.scratch(work.mesh.len(), f64::INFINITY);
    distance.set(source, 0.0)?;
    search(
        work.mesh,
        [source],
        &mut distance,
        reach,
        |target, _| {
            if !seen.has(target) {
                seen.add(target);
                visited.push(target);
            }
            Ok(())
        },
        |cell, _, edge| {
            Ok(
                if cell == source || work.water.column.kind.get(cell)? == 1 {
                    work.mesh.edge_length(cell, edge)
                } else {
                    f64::INFINITY
                },
            )
        },
    )?;
    let mut result = Targets {
        cells: Vec::new(),
        weights: Vec::new(),
    };
    let source_strength = frame.strength.get(source)?;
    for cell in visited {
        if distance.get(cell)? >= reach {
            continue;
        }
        let ocean = work.water.column.kind.get(cell)? == 1;
        let wave = if ocean {
            work.shared.scalar(Scalar::WaveExposure).get(cell)?
        } else {
            frame.strength.get(cell)?
        };
        let shelter = if ocean_only {
            f64::from(ocean)
                / (1.0 + wave + work.shared.scalar(Scalar::OceanCurrentStrength).get(cell)?)
        } else {
            (source_strength - wave).max(0.0)
        };
        if shelter > 0.0 {
            result.cells.push(cell);
            result
                .weights
                .push(shelter * (1.0 - distance.get(cell)? / reach) * work.mesh.area(cell));
        }
    }
    Ok(result)
}
fn deposit(
    work: &mut MaterialWork<'_>,
    p: &Settings,
    source: usize,
    targets: Targets,
    mut material: MaterialLayer,
    wave: f64,
) -> io::Result<()> {
    let volume = material.depth;
    let mut remaining = volume * p.coastal_deposition_fraction / 1000.0;
    let mut weight: f64 = targets.weights.iter().sum();
    let mut deposited = 0.0;
    let runup = work
        .ground
        .scale()
        .resolve(RelativeMeasure::length(0.000005).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value()
        * wave
        / 1000.0;
    let level = work.ground.effective_sea_level() + MapScale::native(runup);
    for (&target, &share) in targets.cells.iter().zip(&targets.weights) {
        let amount = remaining.min(remaining * share / weight);
        let area = work.mesh.area(target);
        let actual = MapScale::metres(
            work.ground.deposit_pond(
                Deposit {
                    cell: target,
                    amount: MapScale::in_units(amount / area, LengthUnit::Native),
                    cause: "coast",
                    material: &material,
                },
                level,
                crate::settlement::stage::Pool::Load,
            )?,
            LengthUnit::Native,
        ) * area;
        deposited += actual;
        remaining = (remaining - actual).max(0.0);
        weight -= share;
    }
    material.depth = volume - deposited;
    let mut entry = if work.water.column.kind.get(source)? == 1 {
        Some(source)
    } else {
        None
    };
    if entry.is_none() {
        for target in targets.cells {
            if work.water.column.kind.get(target)? == 1 {
                entry = Some(target);
                break;
            }
        }
    }
    if let Some(entry) = entry {
        work.ground.carry_out(
            material.depth,
            "coast",
            Some(&material),
            Some((entry, work.sea_load)),
        )
    } else {
        work.load.add(source, &material)
    }
}
use crate::settlement::removal::RemovalGround;
pub(super) fn shores(
    work: &mut MaterialWork<'_>,
    p: &Settings,
    span: f64,
    frame: &Frame,
    loads: &Band<f64>,
    ocean_only: bool,
) -> io::Result<()> {
    for cell in 0..loads.len() {
        let load = loads.get(cell)?;
        if load <= 0.0 {
            continue;
        }
        let targets = targets(
            work,
            frame,
            cell,
            p.coastal_deposition_reach * span,
            ocean_only,
        )?;
        let material = work.load.take(cell, load)?;
        let wave = frame
            .strength
            .get(cell)?
            .max(work.shared.scalar(Scalar::WaveExposure).get(cell)?);
        deposit(work, p, cell, targets, material, wave)?;
    }
    Ok(())
}
