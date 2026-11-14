use crate::{
    hpc::{Direction, KeyedHeap},
    lattice::TriangularLattice,
    storage::Band,
};
use std::io;

pub fn search(
    mesh: &TriangularLattice,
    seeds: impl IntoIterator<Item = usize>,
    distance: &mut Band<f64>,
    reach: f64,
    mut visit: impl FnMut(usize, usize) -> io::Result<()>,
    cost: impl Fn(usize, usize, usize) -> io::Result<f64>,
) -> io::Result<()> {
    let mut queue = KeyedHeap::new([Direction::Ascending], Direction::Ascending);
    for cell in seeds {
        queue.push(cell as u32, [distance.get(cell)?]);
    }
    while let Some((cell, [d])) = queue.pop() {
        let cell = cell as usize;
        if d != distance.get(cell)? {
            continue;
        }
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            let value = d + cost(cell, next, edge)?;
            if value > reach || value >= distance.get(next)? {
                continue;
            }
            distance.set(next, value)?;
            visit(next, cell)?;
            queue.push(next as u32, [value]);
        }
    }
    Ok(())
}
pub fn physical_distance(
    mesh: &TriangularLattice,
    seeds: impl IntoIterator<Item = usize>,
    distance: &mut Band<f64>,
    reach: f64,
    visit: impl FnMut(usize, usize) -> io::Result<()>,
) -> io::Result<()> {
    search(mesh, seeds, distance, reach, visit, |cell, _, edge| {
        Ok(mesh.edge_length(cell, edge))
    })
}
