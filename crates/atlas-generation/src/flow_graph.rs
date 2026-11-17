//! One source-to-target gathering for water, catchment area and transported material.
use crate::storage::{Band, Coverage, ReadBand};
use std::io;

pub struct SourceOrder {
    pub order: Band<u32>,
    pub boundary: Band<u8>,
}
/// Air follows its single upwind source. A loop starts at the last cell that entered it;
/// a later wrapped-air pass may use the column that arrived around the loop.
pub fn source_order(coverage: &mut Coverage, sources: &ReadBand<i32>) -> io::Result<SourceOrder> {
    let n = sources.len();
    let mut state = coverage.scratch(n, 0u8);
    let mut path = coverage.scratch(n, 0u32);
    let mut boundary = coverage.scratch(n, 0u8);
    let mut order = coverage.scratch(n, 0u32);
    let mut tail = 0;
    for start in 0..n {
        if state.get(start)? != 0 {
            continue;
        }
        let mut length = 0;
        let mut current = Some(start);
        while let Some(cell) = current {
            if state.get(cell)? != 0 {
                break;
            }
            state.set(cell, 1)?;
            path.set(length, cell as u32)?;
            length += 1;
            current = usize::try_from(sources.get(cell)?).ok();
        }
        if let Some(cell) = current {
            if state.get(cell)? == 1 {
                boundary.set(path.get(length - 1)? as usize, 1)?;
            }
        }
        for at in (0..length).rev() {
            let cell = path.get(at)?;
            state.set(cell as usize, 2)?;
            order.set(tail, cell)?;
            tail += 1;
        }
    }
    Ok(SourceOrder { order, boundary })
}

#[track_caller]
pub fn target_order(coverage: &mut Coverage, targets: &ReadBand<i32>) -> io::Result<Band<u32>> {
    let n = targets.len();
    let mut indegree = coverage.scratch(n, 0u32);
    let mut order = coverage.scratch(n, 0u32);
    for cell in 0..n {
        if let Ok(target) = usize::try_from(targets.get(cell)?) {
            indegree.set(target, indegree.get(target)? + 1)?;
        }
    }
    let mut count = 0;
    for cell in 0..n {
        if indegree.get(cell)? == 0 {
            order.set(count, cell as u32)?;
            count += 1;
        }
    }
    let mut head = 0;
    while head < count {
        let target = targets.get(order.get(head)? as usize)?;
        head += 1;
        let Ok(target) = usize::try_from(target) else {
            continue;
        };
        let degree = indegree.get(target)? - 1;
        indegree.set(target, degree)?;
        if degree == 0 {
            order.set(count, target as u32)?;
            count += 1;
        }
    }
    if count != n {
        let mut edges = Vec::new();
        for cell in 0..n {
            if indegree.get(cell)? > 0 && edges.len() < 12 {
                edges.push((cell, targets.get(cell)?));
            }
        }
        return Err(io::Error::other(format!(
            "Flow routing contains a cycle at {}: {edges:?}",
            std::panic::Location::caller()
        )));
    }
    Ok(order)
}
pub fn gather_down(
    order: &ReadBand<u32>,
    targets: &ReadBand<i32>,
    carried: &mut Band<f64>,
    mut through: impl FnMut(usize, f64) -> io::Result<f64>,
) -> io::Result<()> {
    for at in 0..order.len() {
        let cell = order.get(at)? as usize;
        let passed = through(cell, carried.get(cell)?)?;
        carried.set(cell, passed)?;
        if let Ok(target) = usize::try_from(targets.get(cell)?) {
            carried.set(target, carried.get(target)? + passed)?;
        }
    }
    Ok(())
}
#[track_caller]
pub fn gathered(
    coverage: &mut Coverage,
    targets: &ReadBand<i32>,
    mut initial: impl FnMut(usize) -> io::Result<f64>,
    through: impl FnMut(usize, f64) -> io::Result<f64>,
) -> io::Result<Band<f64>> {
    let mut carried = coverage.scratch(targets.len(), 0.0);
    let order = target_order(coverage, targets)?;
    for cell in 0..targets.len() {
        carried.set(cell, initial(cell)?)?;
    }
    gather_down(&order.read_only(), targets, &mut carried, through)?;
    Ok(carried)
}
