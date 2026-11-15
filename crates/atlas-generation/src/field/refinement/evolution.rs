use super::topology::{distance, Neighborhood};
use crate::{
    hpc::{BitSet, Direction, KeyedHeap},
    lattice::{Membership, TriangularLattice},
};
use std::io;
#[derive(serde::Serialize, serde::Deserialize)]
pub struct Tree {
    pub receiver: Vec<i32>,
    pub order: Vec<usize>,
    pub cost: Vec<f64>,
}
/// Initial organization only. Actual ground changes use the shared Ground processes.
pub fn drainage_tree(
    mesh: &TriangularLattice,
    height: &[f64],
    effort: impl Fn(usize, usize) -> io::Result<f64>,
    roots: &[u8],
    level: &[f64],
    sea: &[u8],
) -> io::Result<Tree> {
    let mut tree = Tree {
        receiver: vec![-1; mesh.len()],
        order: Vec::new(),
        cost: vec![f64::INFINITY; mesh.len()],
    };
    let mut settled = BitSet::new(mesh.len());
    let around = Neighborhood::new(mesh);
    let mut heap = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for (cell, &root) in roots.iter().enumerate() {
        if root != 0 {
            tree.cost[cell] = level[cell].max(0.0);
            heap.push(cell as u32, [tree.cost[cell]]);
        }
    }
    while let Some((cell, _)) = heap.pop() {
        let cell = cell as usize;
        if !settled.add(cell) {
            continue;
        }
        tree.order.push(cell);
        for &next in around.of(cell) {
            if settled.has(next)
                || roots[next] != 0
                || sea[next] != 0
                || mesh.membership(next) != Membership::Content
            {
                continue;
            }
            let climb = (height[next] - height[cell]).max(0.0);
            let cost = tree.cost[cell] + (distance(mesh, cell, next) + climb) * effort(next, cell)?;
            if cost >= tree.cost[next] {
                continue;
            }
            tree.receiver[next] = cell as i32;
            tree.cost[next] = cost;
            heap.push(next as u32, [cost]);
        }
    }
    Ok(tree)
}
