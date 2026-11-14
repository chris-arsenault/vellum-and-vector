//! Descending component joins identify each summit's highest joining col.
use crate::{
    hpc::Direction,
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;
pub struct Prominence {
    pub rise: Band<f64>,
    pub saddle: Band<i32>,
}
fn root(parent: &mut Band<i32>, mut cell: usize) -> io::Result<usize> {
    let mut found = cell;
    while parent.get(found)? != found as i32 {
        found = parent.get(found)? as usize;
    }
    while cell != found {
        let next = parent.get(cell)? as usize;
        parent.set(cell, found as i32)?;
        cell = next;
    }
    Ok(found)
}
pub fn topographic_prominence(
    coverage: &mut Coverage,
    mesh: &TriangularLattice,
    elevation: &ReadBand<f64>,
    datum: f64,
) -> io::Result<Prominence> {
    let count = elevation.len();
    let mut parent = coverage.scratch(count, -1i32);
    let mut summit = coverage.scratch(count, 0u32);
    let mut rise = coverage.scratch(count, 0.0);
    let mut saddle = coverage.scratch(count, -1i32);
    for cell in coverage.order(elevation, Direction::Descending)? {
        let cell = cell?;
        if elevation.get(cell)? <= datum {
            break;
        }
        parent.set(cell, cell as i32)?;
        summit.set(cell, cell as u32)?;
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if parent.get(next)? < 0 {
                continue;
            }
            let a = root(&mut parent, cell)?;
            let b = root(&mut parent, next)?;
            if a == b {
                continue;
            }
            let top_a = summit.get(a)? as usize;
            let top_b = summit.get(b)? as usize;
            let a_higher = elevation.get(top_a)? > elevation.get(top_b)?
                || (elevation.get(top_a)? == elevation.get(top_b)? && top_a < top_b);
            let (high, low) = if a_higher { (a, b) } else { (b, a) };
            let peak = summit.get(low)? as usize;
            rise.set(peak, elevation.get(peak)? - elevation.get(cell)?)?;
            saddle.set(peak, cell as i32)?;
            parent.set(low, high as i32)?;
        }
    }
    for cell in 0..count {
        if parent.get(cell)? == cell as i32 {
            let peak = summit.get(cell)? as usize;
            rise.set(peak, elevation.get(peak)? - datum)?;
        }
    }
    Ok(Prominence { rise, saddle })
}
