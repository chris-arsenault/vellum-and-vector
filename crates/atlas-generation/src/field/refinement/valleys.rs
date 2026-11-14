use crate::{
    hpc::{BitSet, Direction, KeyedHeap},
    lattice::TriangularLattice,
};
use std::io;

pub struct Scratch {
    inside: BitSet,
    cost: Vec<f64>,
}
impl Scratch {
    pub fn new(count: usize) -> Self {
        Self {
            inside: BitSet::new(count),
            cost: vec![0.0; count],
        }
    }
}
pub fn shares(
    order: &[usize],
    seeds: usize,
    mut available: f64,
    area: impl Fn(usize) -> f64,
) -> Vec<f64> {
    let course_area: f64 = order.iter().take(seeds).map(|&cell| area(cell)).sum();
    let course_share = if course_area > 0.0 {
        (available / course_area).min(1.0)
    } else {
        0.0
    };
    order
        .iter()
        .enumerate()
        .map(|(at, &cell)| {
            let share = if at < seeds {
                course_share
            } else {
                (available / area(cell)).clamp(0.0, 1.0)
            };
            available -= share * area(cell);
            share
        })
        .collect()
}
pub fn order(
    mesh: &TriangularLattice,
    cells: &[usize],
    seeds: &[usize],
    resistance: impl Fn(usize, usize) -> io::Result<f64>,
    scratch: &mut Scratch,
) -> io::Result<Vec<usize>> {
    let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    let mut placed = Vec::with_capacity(cells.len());
    for &cell in cells {
        scratch.inside.add(cell);
        scratch.cost[cell] = f64::INFINITY;
    }
    for &cell in seeds {
        scratch.cost[cell] = 0.0;
        heap.push(cell as u32, [0.0]);
    }
    while let Some((cell, _)) = heap.pop() {
        let cell = cell as usize;
        if !scratch.inside.has(cell) {
            continue;
        }
        scratch.inside.clear(cell);
        placed.push(cell);
        let [x, y] = mesh.position(cell);
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if !scratch.inside.has(next) {
                continue;
            }
            let [nx, ny] = mesh.position(next);
            let work =
                scratch.cost[cell] + mesh.delta_x(nx - x).hypot(ny - y) * resistance(next, cell)?;
            if work >= scratch.cost[next] {
                continue;
            }
            scratch.cost[next] = work;
            heap.push(next as u32, [work]);
        }
    }
    for &cell in cells {
        if scratch.inside.has(cell) {
            placed.push(cell);
            scratch.inside.clear(cell);
        }
    }
    Ok(placed)
}

/// Main drainage through one captured donor, including its greatest feeders.
pub fn stream_cells(
    cells: &[usize],
    area: &[f64],
    receiver: &[i32],
    inside: &mut BitSet,
    seen: &mut BitSet,
) -> Vec<usize> {
    if cells.is_empty() {
        return Vec::new();
    }
    for &cell in cells {
        inside.add(cell);
    }
    let mut most = cells[0];
    for &cell in &cells[1..] {
        if area[cell] > area[most] {
            most = cell;
        }
    }
    let mut steps = Vec::new();
    let mut at = most as i32;
    while at >= 0 && inside.has(at as usize) && !seen.has(at as usize) {
        let cell = at as usize;
        seen.add(cell);
        steps.push(cell);
        at = receiver[cell];
    }
    let mut cell = most;
    loop {
        let mut feeder = None;
        for &other in cells {
            if receiver[other] == cell as i32
                && !seen.has(other)
                && feeder.is_none_or(|best| area[other] > area[best])
            {
                feeder = Some(other);
            }
        }
        let Some(next) = feeder else {
            break;
        };
        seen.add(next);
        steps.push(next);
        cell = next;
    }
    for &cell in cells {
        inside.clear(cell);
    }
    for &cell in &steps {
        seen.clear(cell);
    }
    steps
}
