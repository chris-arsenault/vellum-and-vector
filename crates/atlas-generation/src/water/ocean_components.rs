use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub fn ocean_seeds(mesh: &TriangularLattice, elevation: &ReadBand<f64>) -> io::Result<Vec<usize>> {
    let mut seeds = Vec::new();
    let mut deepest = 0;
    for cell in 0..mesh.len() {
        if mesh.boundary(cell) {
            seeds.push(cell);
        }
        if elevation.get(cell)? < elevation.get(deepest)? {
            deepest = cell;
        }
    }
    if seeds.is_empty() && !mesh.is_empty() {
        seeds.push(deepest);
    }
    Ok(seeds)
}
pub struct OceanComponents {
    seeds: Band<u8>,
    parent: Band<i32>,
    sizes: Band<u32>,
    contents: Band<f64>,
    boundary: Band<u8>,
    pub connected: f64,
}
impl OceanComponents {
    pub fn new(
        mesh: &TriangularLattice,
        elevation: &ReadBand<f64>,
        coverage: &mut Coverage,
    ) -> io::Result<Self> {
        let mut seeds = coverage.scratch(mesh.len(), 0u8);
        for seed in ocean_seeds(mesh, elevation)? {
            seeds.set(seed, 1)?;
        }
        Ok(Self {
            seeds,
            parent: coverage.scratch(mesh.len(), -1),
            sizes: coverage.scratch(mesh.len(), 0),
            contents: coverage.scratch(mesh.len(), 0.0),
            boundary: coverage.scratch(mesh.len(), 0),
            connected: 0.0,
        })
    }
    pub fn activate(&mut self, mesh: &TriangularLattice, cell: usize) -> io::Result<()> {
        self.parent.set(cell, cell as i32)?;
        self.sizes.set(cell, 1)?;
        let content = mesh.area(cell);
        self.contents.set(cell, content)?;
        let seed = self.seeds.get(cell)?;
        self.boundary.set(cell, seed)?;
        if seed != 0 {
            self.connected += content;
        }
        Ok(())
    }
    fn root(&mut self, mut cell: usize) -> io::Result<usize> {
        let mut root = cell;
        while self.parent.get(root)? != root as i32 {
            root = self.parent.get(root)? as usize;
        }
        while self.parent.get(cell)? != cell as i32 {
            let next = self.parent.get(cell)? as usize;
            self.parent.set(cell, root as i32)?;
            cell = next;
        }
        Ok(root)
    }
    fn union(&mut self, first: usize, second: usize) -> io::Result<()> {
        let (mut a, mut b) = (self.root(first)?, self.root(second)?);
        if a == b {
            return Ok(());
        }
        if self.sizes.get(a)? < self.sizes.get(b)? {
            std::mem::swap(&mut a, &mut b);
        }
        if self.boundary.get(a)? != 0 {
            self.connected -= self.contents.get(a)?;
        }
        if self.boundary.get(b)? != 0 {
            self.connected -= self.contents.get(b)?;
        }
        self.parent.set(b, a as i32)?;
        self.sizes.set(a, self.sizes.get(a)? + self.sizes.get(b)?)?;
        self.contents
            .set(a, self.contents.get(a)? + self.contents.get(b)?)?;
        self.boundary
            .set(a, self.boundary.get(a)? | self.boundary.get(b)?)?;
        if self.boundary.get(a)? != 0 {
            self.connected += self.contents.get(a)?;
        }
        Ok(())
    }
    pub fn connect(&mut self, mesh: &TriangularLattice, cell: usize) -> io::Result<()> {
        for edge in 0..3 {
            if let Some(next) = mesh.neighbor(cell, edge) {
                if self.parent.get(next)? >= 0 {
                    self.union(cell, next)?;
                }
            }
        }
        Ok(())
    }
}
pub fn visit_connected(
    mesh: &TriangularLattice,
    elevation: &ReadBand<f64>,
    level: f64,
    coverage: &mut Coverage,
    mut visit: impl FnMut(usize) -> io::Result<()>,
) -> io::Result<()> {
    let mut seen = coverage.scratch(mesh.len(), 0u8);
    let mut queue = coverage.scratch(mesh.len(), 0u32);
    let mut count = 0;
    for cell in ocean_seeds(mesh, elevation)? {
        if seen.get(cell)? != 0 || elevation.get(cell)? >= level {
            continue;
        }
        seen.set(cell, 1)?;
        queue.set(count, cell as u32)?;
        count += 1;
        visit(cell)?;
    }
    let mut head = 0;
    while head < count {
        let cell = queue.get(head)? as usize;
        head += 1;
        for edge in 0..3 {
            let Some(next) = mesh.neighbor(cell, edge) else {
                continue;
            };
            if seen.get(next)? != 0 || elevation.get(next)? >= level {
                continue;
            }
            seen.set(next, 1)?;
            queue.set(count, next as u32)?;
            count += 1;
            visit(next)?;
        }
    }
    Ok(())
}
