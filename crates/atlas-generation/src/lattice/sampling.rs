//! Piecewise linear triangle fans from world/triangleSampling.ts.
use super::TriangularLattice;
use std::io;

pub struct Sampler<'a> {
    mesh: &'a TriangularLattice,
    cache: Cache,
}
pub struct Cache {
    degree: Vec<u8>,
    cells: Vec<usize>,
    facing: Vec<Option<usize>>,
}
impl<'a> Sampler<'a> {
    pub fn new(mesh: &'a TriangularLattice) -> Self {
        Self {
            mesh,
            cache: Cache::new(mesh.len()),
        }
    }
    pub fn sample(
        &mut self,
        point: [f64; 2],
        read: impl Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        self.cache.sample(self.mesh, point, read)
    }
}
impl Cache {
    pub fn new(length: usize) -> Self {
        Self {
            degree: vec![0; length * 3],
            cells: vec![0; length * 18],
            facing: vec![None; length * 3],
        }
    }
    pub fn sample(
        &mut self,
        mesh: &TriangularLattice,
        point: [f64; 2],
        read: impl Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        let [x, y] = mesh.point(point[0], point[1]);
        let Some(cell) = mesh.cell_at(x, y) else {
            // Beyond the map the value clamps to the edge cell's own.
            return mesh.edge_cell(x, y).map_or(Ok(0.0), read);
        };
        let barycentric = mesh.barycentric(cell, [x, y]);
        let minimum = barycentric
            .into_iter()
            .fold(f64::INFINITY, f64::min)
            .max(0.0);
        let maximum = barycentric.into_iter().fold(f64::NEG_INFINITY, f64::max);
        let middle = 1.0 - minimum - maximum;
        let center = 3.0 * minimum;
        let vertex = (maximum - middle).max(0.0);
        let face = (2.0 * (middle - minimum)).max(0.0);
        let corner = barycentric.iter().position(|&v| v == maximum).unwrap();
        let opposite = (0..3)
            .min_by(|&a, &b| barycentric[a].total_cmp(&barycentric[b]))
            .unwrap();
        let row = cell * 3 + opposite;
        let neighbor = *self.facing[row].get_or_insert_with(|| {
            let edge = if mesh.inverted(cell) && opposite > 0 {
                3 - opposite
            } else {
                opposite
            };
            mesh.neighbor(cell, edge).unwrap_or(cell)
        });
        let row = cell * 3 + corner;
        if self.degree[row] == 0 {
            let members = vertex_members(mesh, cell, corner);
            self.cells[row * 6..row * 6 + members.len()].copy_from_slice(&members);
            self.degree[row] = members.len() as u8 + 1;
        }
        let members = &self.cells[row * 6..row * 6 + self.degree[row] as usize - 1];
        let base = read(cell)?;
        let first = read(members[0])?;
        let mut sum = 0.0;
        for &member in members {
            sum += read(member)? - first;
        }
        let mean = first + sum / members.len() as f64;
        Ok(base
            + (vertex * (mean - base) + face * (read(neighbor)? - base) / 2.0)
                / (center + vertex + face))
    }
}
pub fn vertex_members(mesh: &TriangularLattice, cell: usize, corner: usize) -> Vec<usize> {
    let (u, v, inverted) = mesh.address(cell);
    let sign = if inverted { -1 } else { 1 };
    let x = 3 * (u + v) + if inverted { 4 } else { 2 } + if corner == 0 { -2 * sign } else { sign };
    let y = -u
        + v
        + match corner {
            0 => 0,
            1 => -1,
            _ => 1,
        };
    let a = (x / 3 - y) / 2;
    let b = (x / 3 + y) / 2;
    let mut members = Vec::with_capacity(6);
    for (u, v, inverted) in [
        (a, b, false),
        (a - 1, b, false),
        (a, b - 1, false),
        (a - 1, b - 1, true),
        (a, b - 1, true),
        (a - 1, b, true),
    ] {
        if let Some(member) = mesh.address_cell(u, v, inverted) {
            match members.binary_search(&member) {
                Ok(_) => {}
                Err(at) => members.insert(at, member),
            }
        }
    }
    members
}
