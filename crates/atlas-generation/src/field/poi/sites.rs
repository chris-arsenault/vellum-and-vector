use crate::{
    lattice::TriangularLattice,
    spatial::{SpatialIndex, SpatialKernel},
};
use atlas_map::{Bounds, Geometry, Position};
use std::io;

pub struct Sites<'a> {
    cells: Vec<usize>,
    index: Option<Box<dyn SpatialIndex + 'a>>,
}
impl<'a> Sites<'a> {
    pub fn new(
        kernel: &'a dyn SpatialKernel,
        mesh: &TriangularLattice,
        cells: Vec<usize>,
    ) -> io::Result<Self> {
        if cells.is_empty() {
            return Ok(Self { cells, index: None });
        }
        let shifts = mesh
            .periodic_width()
            .map_or(vec![0.0], |width| vec![0.0, -width, width]);
        let mut points = Vec::new();
        for shift in shifts {
            for &cell in &cells {
                let [x, y] = mesh.position(cell);
                points.push(Geometry::Point {
                    coordinates: Position::xy(x + shift, y),
                });
            }
        }
        Ok(Self {
            cells,
            index: Some(kernel.index(&points).map_err(io::Error::other)?),
        })
    }
    pub fn nearest(&self, mesh: &TriangularLattice, cell: usize) -> io::Result<Option<usize>> {
        let Some(index) = &self.index else {
            return Ok(None);
        };
        let [x, y] = mesh.position(cell);
        Ok(index
            .nearest(Position::xy(x, y))
            .map_err(io::Error::other)?
            .map(|at| self.cells[at % self.cells.len()]))
    }
    pub fn around(
        &self,
        mesh: &TriangularLattice,
        cell: usize,
        radius: f64,
    ) -> io::Result<Vec<usize>> {
        let Some(index) = &self.index else {
            return Ok(Vec::new());
        };
        let [x, y] = mesh.position(cell);
        Ok(index
            .query(Bounds(x - radius, y - radius, x + radius, y + radius))
            .map_err(io::Error::other)?
            .into_iter()
            .map(|at| self.cells[at % self.cells.len()])
            .collect())
    }
}
pub fn within(mesh: &TriangularLattice, cell: usize, radius: f64) -> Vec<usize> {
    let [x, y] = mesh.position(cell);
    let origin = mesh.origin();
    let [x, y] = [x + origin[0], y + origin[1]];
    let mut found: Vec<_> = mesh
        .window_cells(Bounds(x - radius, y - radius, x + radius, y + radius))
        .into_iter()
        .filter(|&other| super::super::refinement::topology::distance(mesh, cell, other) <= radius)
        .collect();
    if !found.contains(&cell) {
        found.insert(0, cell);
    }
    found
}
pub fn nearest_where(
    mesh: &TriangularLattice,
    kernel: &dyn SpatialKernel,
    cell: usize,
    radius: f64,
    test: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<Option<usize>> {
    let mut cells = Vec::new();
    for other in within(mesh, cell, radius) {
        if test(other)? {
            cells.push(other);
        }
    }
    Sites::new(kernel, mesh, cells)?.nearest(mesh, cell)
}
