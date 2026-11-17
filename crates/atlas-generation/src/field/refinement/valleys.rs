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
/// How much of the inherited cut depth each cell takes, in `order` from the course outward.
/// The course takes the full depth and the valley sides shallow with the area already laid
/// toward the course, `1 − a / reach`, so the valley has sloping sides and the same volume
/// as `available` cells cut to the full depth: a valley, not a flat-floored trench.
pub fn shares(
    order: &[usize],
    seeds: usize,
    available: f64,
    area: impl Fn(usize) -> f64,
) -> Vec<f64> {
    let course_area: f64 = order.iter().take(seeds).map(|&cell| area(cell)).sum();
    let course_share = if course_area > 0.0 {
        (available / course_area).min(1.0)
    } else {
        0.0
    };
    let sides = available - course_share * course_area;
    // The sides' triangular profile holds `reach / 2` of full-depth area.
    let reach = 2.0 * sides.max(0.0);
    let mut laid = 0.0;
    order
        .iter()
        .enumerate()
        .map(|(at, &cell)| {
            if at < seeds {
                return course_share;
            }
            let a = area(cell);
            let middle = laid + a / 2.0;
            laid += a;
            if reach <= 0.0 {
                0.0
            } else {
                (1.0 - middle / reach).clamp(0.0, 1.0)
            }
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

#[cfg(test)]
mod tests {
    use super::shares;
    #[test]
    fn a_valley_is_deepest_on_its_course_and_shallows_outward_holding_its_volume() {
        let order = (0..100).collect::<Vec<_>>();
        let available = 20.0;
        let result = shares(&order, 2, available, |_| 1.0);
        assert_eq!(&result[..2], &[1.0, 1.0]);
        assert!(result[2..].windows(2).all(|w| w[0] >= w[1]));
        assert!(result[2] > 0.9 && result[30] > 0.0 && result[40] == 0.0);
        let volume: f64 = result.iter().sum();
        assert!((volume - available).abs() < 0.1, "{volume}");
    }
}
