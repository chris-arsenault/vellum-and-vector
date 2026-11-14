use super::{surface::Surface, Settings};
use crate::{
    field::{
        material::MaterialWork,
        shared::{CellCode as C, Flag, Scalar as S},
    },
    flow_graph::target_order,
    rock::{ground::GroundField, load::MaterialLoad},
    scale::{LengthUnit, MapScale},
    settlement::stage::{Deposit, StageGround},
};
use std::io;
fn release(work: &mut MaterialWork<'_>, moving: &mut MaterialLoad, cell: usize) -> io::Result<()> {
    let material = moving.take(cell, moving.amount(cell)?)?;
    if material.depth <= 0.0 {
        return Ok(());
    }
    if work.water.column.kind.get(cell)? == 1 {
        work.ground.carry_out(
            material.depth,
            "moraines",
            Some(&material),
            Some((cell, work.sea_load)),
        )
    } else {
        work.load.add(cell, &material)
    }
}
fn carries(work: &MaterialWork<'_>, cell: usize) -> io::Result<bool> {
    Ok(work.shared.flag(Flag::GroundedIce).get(cell)? != 0
        && work.shared.scalar(S::IceThickness).get(cell)? > 0.0)
}
fn room(
    work: &MaterialWork<'_>,
    p: &Settings,
    cell: usize,
    target: Option<usize>,
) -> io::Result<f64> {
    let elevation = work.ground.view(GroundField::Elevation);
    let ahead = match target {
        Some(target) => elevation.get(target)?,
        None => work.water.effective_sea_level,
    };
    let holds = p.mass_wasting_stable_gradient * p.hillslope_length.min(work.mesh.spacing());
    Ok((ahead + MapScale::native(holds) - elevation.get(cell)?).max(0.0))
}
pub(super) fn run(work: &mut MaterialWork<'_>, p: &Settings) -> io::Result<()> {
    let mut moving = MaterialLoad::new(work.coverage);
    let targets = work.shared.code(C::IceFlowTargets);
    let order = target_order(work.coverage, &targets)?;
    for at in 0..order.len() {
        let cell = order.get(at)? as usize;
        if !carries(work, cell)? {
            release(work, &mut moving, cell)?;
            continue;
        }
        moving.add(cell, &work.load.take(cell, work.load.amount(cell)?)?)?;
        let load = moving.amount(cell)?;
        if load <= 0.0 {
            continue;
        }
        let target = usize::try_from(targets.get(cell)?).ok();
        let terminus = match target {
            Some(target) => !carries(work, target)?,
            None => true,
        };
        let deposited = if terminus {
            let amount = MapScale::in_units(load / work.mesh.area(cell), LengthUnit::Native)
                .min(room(work, p, cell, target)?);
            work.ground.deposit(Deposit {
                cell,
                amount,
                cause: "moraines",
                material: &moving.get(cell)?,
            })?
        } else {
            0.0
        };
        if deposited > 0.0 {
            let surface = Surface::new(work.ground, work.shared, &work.water);
            work.shared
                .flag_mut(Flag::GroundedIce)
                .set(cell, u8::from(surface.grounded(cell, p)?))?;
        }
        let history = work.shared.scalar_mut(S::CumulativeGlacialDeposition);
        history.set(cell, history.get(cell)? + deposited)?;
        moving.take(
            cell,
            MapScale::metres(deposited, LengthUnit::Native) * work.mesh.area(cell),
        )?;
        if let Some(target) = target {
            let material = moving.take(cell, moving.amount(cell)?)?;
            moving.add(target, &material)?;
        } else {
            release(work, &mut moving, cell)?;
        }
    }
    Ok(())
}
