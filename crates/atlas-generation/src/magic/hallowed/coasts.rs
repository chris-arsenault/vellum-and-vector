use crate::{
    field::shared::Scalar as F,
    magic::sources::Environment,
    storage::{Band, Coverage},
};
use std::io;
pub fn redirect(
    env: &Environment<'_>,
    totals: &mut Band<f64>,
    coverage: &mut Coverage,
) -> io::Result<()> {
    let mut moved = coverage.scratch(env.mesh.len(), 0.0);
    for cell in 0..env.mesh.len() {
        let ward = env.scalar(F::Warding, cell)?;
        let total = totals.get(cell)?;
        if ward <= 0.0 || env.water.column.kind.get(cell)? != 0 || total <= 0.0 {
            continue;
        }
        let taken = (total * ward + 0.5).floor();
        if let Some(target) = downdrift(env, cell)? {
            totals.set(cell, total - taken)?;
            moved.set(target, moved.get(target)? + taken)?;
        }
    }
    for cell in 0..env.mesh.len() {
        let added = moved.get(cell)?;
        if added > 0.0 {
            totals.set(
                cell,
                (totals.get(cell)? + (added + 0.5).floor()).clamp(0.0, 1000.0),
            )?;
        }
    }
    Ok(())
}
fn downdrift(env: &Environment<'_>, cell: usize) -> io::Result<Option<usize>> {
    let mut direction = [0.0; 2];
    let mut strength = 0.0;
    for edge in 0..3 {
        let Some(next) = env.mesh.neighbor(cell, edge) else {
            continue;
        };
        let current = env.scalar(F::OceanCurrentStrength, next)?;
        if env.water.column.kind.get(next)? != 1 || current <= strength {
            continue;
        }
        direction = [
            env.scalar(F::OceanCurrentX, next)?,
            env.scalar(F::OceanCurrentY, next)?,
        ];
        strength = current;
    }
    if strength <= 0.0 {
        return Ok(None);
    }
    let mut best = None;
    let mut score = 0.0;
    for edge in 0..3 {
        let Some(next) = env.mesh.neighbor(cell, edge) else {
            continue;
        };
        if !open_shore(env, next)? {
            continue;
        }
        let [dx, dy] = env.mesh.edge_direction(cell, edge);
        let alignment = dx * direction[0] + dy * direction[1];
        if alignment > score {
            best = Some(next);
            score = alignment;
        }
    }
    Ok(best)
}
fn open_shore(env: &Environment<'_>, cell: usize) -> io::Result<bool> {
    if env.water.column.kind.get(cell)? != 0 || env.scalar(F::Warding, cell)? > 0.0 {
        return Ok(false);
    }
    for edge in 0..3 {
        if let Some(next) = env.mesh.neighbor(cell, edge) {
            if env.water.column.kind.get(next)? == 1 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
