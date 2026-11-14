use super::topology::{components, frame_edge, resolves};
use crate::{
    hpc::{BitSet, Direction, KeyedHeap},
    lattice::{Membership, TriangularLattice},
};

pub fn flood_levels(
    mesh: &TriangularLattice,
    values: &[f64],
    outlet: impl Fn(usize) -> bool,
) -> Vec<f64> {
    let mut filled = values.to_vec();
    let mut seen = BitSet::new(mesh.len());
    let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for (cell, &value) in values.iter().enumerate() {
        if outlet(cell) {
            seen.add(cell);
            heap.push(cell as u32, [value]);
        }
    }
    while let Some((cell, _)) = heap.pop() {
        let cell = cell as usize;
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if !seen.add(next) {
                continue;
            }
            filled[next] = values[next].max(filled[cell]);
            heap.push(next as u32, [filled[next]]);
        }
    }
    filled
}
pub fn connected_sea(mesh: &TriangularLattice, height: &[f64], captured_ocean: &[u8]) -> Vec<u8> {
    let mut sea = vec![0; mesh.len()];
    let mut queue = Vec::new();
    for (cell, &value) in height.iter().enumerate() {
        if value <= 0.0
            && (mesh.membership(cell) != Membership::Content
                || mesh.boundary(cell)
                || captured_ocean[cell] != 0)
        {
            sea[cell] = 1;
            queue.push(cell);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(queue[head], edge) else {
                continue;
            };
            if sea[next] != 0 || height[next] > 0.0 {
                continue;
            }
            sea[next] = 1;
            queue.push(next);
        }
        head += 1;
    }
    sea
}
pub struct Sinks {
    pub sink: Vec<u8>,
    pub bowl: Vec<u8>,
}
pub fn captured_sinks(
    mesh: &TriangularLattice,
    base: &[f64],
    sea: &[u8],
    lake: &[i32],
    basin_depth: f64,
    span: f64,
) -> Sinks {
    let filled = flood_levels(mesh, base, |i| {
        sea[i] != 0 || mesh.boundary(i) || frame_edge(mesh, i)
    });
    let depth: Vec<f64> = (0..mesh.len())
        .map(|i| {
            if sea[i] != 0 || lake[i] >= 0 {
                0.0
            } else {
                filled[i] - base[i]
            }
        })
        .collect();
    let mut result = Sinks {
        sink: vec![0; mesh.len()],
        bowl: vec![0; mesh.len()],
    };
    components(
        mesh,
        |i| depth[i] > 1e-3,
        |cells| {
            let mut deepest = 0.0f64;
            let mut lowest = cells[0];
            for &cell in cells {
                deepest = deepest.max(depth[cell]);
                if base[cell] < base[lowest] {
                    lowest = cell;
                }
            }
            if deepest < basin_depth || !resolves(mesh, cells, span, 3.0) {
                return;
            }
            result.sink[lowest] = 1;
            for &cell in cells {
                result.bowl[cell] = 1;
            }
        },
    );
    result
}
pub fn lake_hollows(
    mesh: &TriangularLattice,
    height: &[f64],
    sea: &[u8],
    pool_depth: f64,
) -> Vec<u8> {
    let filled = flood_levels(mesh, height, |i| {
        sea[i] != 0 || mesh.boundary(i) || frame_edge(mesh, i)
    });
    let mut held = vec![0; mesh.len()];
    components(
        mesh,
        |i| sea[i] == 0 && filled[i] - height[i] > 1e-3,
        |cells| {
            if cells.len() < 3 || !cells.iter().any(|&i| filled[i] - height[i] >= pool_depth) {
                return;
            }
            for &cell in cells {
                held[cell] = 1;
            }
        },
    );
    held
}
