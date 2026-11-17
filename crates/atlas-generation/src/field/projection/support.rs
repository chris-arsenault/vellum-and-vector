//! Private class contributions retained before capture chooses one inspection category.
use crate::{
    checkpoint::Archive,
    lattice::{sampling::memberships, TriangularLattice},
    magic::surface::Surfaces,
    reconstruction::Grid,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

// A triangle fan has a centre, a face neighbour and at most six vertex neighbours.
pub const STRIDE: usize = 16;

#[derive(Clone)]
pub struct ReadSupport {
    pub final_surface: ReadBand<f64>,
    pub natural: ReadBand<f64>,
}
impl ReadSupport {
    pub fn channel(&self, name: &str) -> Option<ReadBand<f64>> {
        match name {
            "finalSurface" => Some(self.final_surface.clone()),
            "naturalSurface" => Some(self.natural.clone()),
            _ => None,
        }
    }
    pub fn validate(&self, samples: usize) -> io::Result<()> {
        if samples.checked_mul(STRIDE) != Some(self.final_surface.len())
            || self.final_surface.len() != self.natural.len()
        {
            return Err(io::Error::other(
                "Class contributions must cover their captured grid",
            ));
        }
        Ok(())
    }
}
pub fn visit(
    values: &ReadBand<f64>,
    cell: usize,
    mut visit: impl FnMut(i32, f64),
) -> io::Result<()> {
    for slot in (cell * STRIDE..(cell + 1) * STRIDE).step_by(2) {
        let weight = values.get(slot + 1)?;
        if weight > 0.0 {
            visit(values.get(slot)? as i32, weight);
        }
    }
    Ok(())
}
pub struct Support {
    final_surface: Band<f64>,
    natural: Band<f64>,
}
impl Support {
    pub(super) fn empty(coverage: &mut Coverage) -> Self {
        Self {
            final_surface: coverage.scratch(0, 0.0),
            natural: coverage.scratch(0, 0.0),
        }
    }
    pub(super) fn capture(
        grid: &Grid,
        mesh: &TriangularLattice,
        surfaces: &Surfaces,
        coverage: &mut Coverage,
    ) -> io::Result<Self> {
        let mut support = Self::empty(coverage);
        support.project(grid, mesh, surfaces, coverage)?;
        Ok(support)
    }
    pub(super) fn project(
        &mut self,
        grid: &Grid,
        mesh: &TriangularLattice,
        surfaces: &Surfaces,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        capture(
            grid,
            mesh,
            &surfaces.final_surface,
            coverage,
            &mut self.final_surface,
        )?;
        capture(grid, mesh, &surfaces.natural, coverage, &mut self.natural)
    }
    pub fn read(&self) -> ReadSupport {
        ReadSupport {
            final_surface: self.final_surface.read_only(),
            natural: self.natural.read_only(),
        }
    }
    pub(super) fn checkpoint(
        &mut self,
        archive: &mut Archive<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        archive.allocated_band("final-contributions", &mut self.final_surface, coverage)?;
        archive.allocated_band("natural-contributions", &mut self.natural, coverage)
    }
}
fn capture(
    grid: &Grid,
    mesh: &TriangularLattice,
    values: &Band<i32>,
    coverage: &mut Coverage,
    output: &mut Band<f64>,
) -> io::Result<()> {
    let count = grid
        .measures
        .len()
        .checked_mul(STRIDE)
        .ok_or_else(|| io::Error::other("Class contributions exceed array representation"))?;
    if output.len() != count {
        *output = coverage.scratch(count, 0.0);
        output.retain();
    }
    let origin = mesh.origin();
    for cell in 0..grid.measures.len() {
        let p = grid.position(cell)?;
        let contributions = memberships(mesh, [p[0] - origin[0], p[1] - origin[1]], |i| {
            values.get(i)
        })?;
        let mut block = [0.0; STRIDE];
        for (slot, (code, weight)) in contributions.into_iter().enumerate() {
            block[slot * 2] = f64::from(code);
            block[slot * 2 + 1] = weight;
        }
        super::sampling::write_range(output, cell * STRIDE, &block)?;
    }
    Ok(())
}
