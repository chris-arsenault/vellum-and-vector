//! Local walks on the same triangular lattice used by all generation.
use crate::{hpc::BitSet, lattice::TriangularLattice};

pub fn distance(mesh: &TriangularLattice, a: usize, b: usize) -> f64 {
    let [x, y] = mesh.position(a);
    let [nx, ny] = mesh.position(b);
    mesh.delta_x(nx - x).hypot(ny - y)
}
pub fn components(
    mesh: &TriangularLattice,
    includes: impl Fn(usize) -> bool,
    mut visit: impl FnMut(&[usize]),
) {
    let mut seen = BitSet::new(mesh.len());
    for start in 0..mesh.len() {
        if seen.has(start) || !includes(start) {
            continue;
        }
        let mut cells = vec![start];
        seen.add(start);
        let mut head = 0;
        while head < cells.len() {
            for edge in 0..3 {
                let Some(next) = mesh.neighbor(cells[head], edge) else {
                    continue;
                };
                if !seen.has(next) && includes(next) {
                    seen.add(next);
                    cells.push(next);
                }
            }
            head += 1;
        }
        visit(&cells);
    }
}
pub fn resolves(mesh: &TriangularLattice, cells: &[usize], span: f64, across: f64) -> bool {
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for &cell in cells {
        let [x, y] = mesh.position(cell);
        bounds[0] = bounds[0].min(x);
        bounds[1] = bounds[1].min(y);
        bounds[2] = bounds[2].max(x);
        bounds[3] = bounds[3].max(y);
    }
    bounds[2] - bounds[0] >= (across - 1.0) * span && bounds[3] - bounds[1] >= (across - 1.0) * span
}
pub fn within(mesh: &TriangularLattice, center: usize, reach: f64) -> Vec<usize> {
    let mut seen = BitSet::new(mesh.len());
    let mut cells = vec![center];
    seen.add(center);
    let mut head = 0;
    while head < cells.len() {
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cells[head], edge) else {
                continue;
            };
            if seen.has(next) || distance(mesh, center, next) > reach {
                continue;
            }
            seen.add(next);
            cells.push(next);
        }
        head += 1;
    }
    cells
}
pub struct Neighborhood {
    offsets: Vec<usize>,
    cells: Vec<usize>,
}
impl Neighborhood {
    pub fn new(mesh: &TriangularLattice) -> Self {
        let mut offsets = Vec::with_capacity(mesh.len() + 1);
        let mut cells = Vec::new();
        let reach = 2.0 * mesh.spacing() * (1.0 + 1e-6);
        for cell in 0..mesh.len() {
            offsets.push(cells.len());
            let mut ring = Vec::with_capacity(12);
            for edge in 0..3 {
                if let Some(next) = mesh.neighbor(cell, edge) {
                    ring.push(next);
                }
            }
            let mut head = 0;
            while head < ring.len() && ring.len() < 12 {
                for edge in 0..3 {
                    let Some(next) = mesh.neighbor(ring[head], edge) else {
                        continue;
                    };
                    if next != cell
                        && ring.len() < 12
                        && distance(mesh, cell, next) <= reach
                        && !ring.contains(&next)
                    {
                        ring.push(next);
                    }
                }
                head += 1;
            }
            cells.extend(ring);
        }
        offsets.push(cells.len());
        Self { offsets, cells }
    }
    pub fn of(&self, cell: usize) -> &[usize] {
        &self.cells[self.offsets[cell]..self.offsets[cell + 1]]
    }
}
