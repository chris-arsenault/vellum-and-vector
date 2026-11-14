use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Operator {
    pub count: usize,
    pub cells: Option<Band<u32>>,
    pub areas: Band<f64>,
    pub diagonal: Band<f64>,
    pub offsets: Band<u32>,
    pub neighbors: Band<u32>,
    pub weights: Band<f64>,
}
fn metric_cells(
    mesh: &TriangularLattice,
    coverage: &mut Coverage,
    active: Option<&ReadBand<u8>>,
) -> io::Result<(Band<u32>, Band<i32>)> {
    let included = |cell| -> io::Result<bool> {
        Ok(active.map(|a| a.get(cell)).transpose()?.unwrap_or(1) != 0)
    };
    let mut count = 0;
    for cell in 0..mesh.len() {
        if included(cell)? {
            count += 1;
        }
    }
    let mut cells = coverage.scratch(count, 0u32);
    let mut local = coverage.scratch(mesh.len(), -1i32);
    let mut index = 0;
    for cell in 0..mesh.len() {
        if included(cell)? {
            cells.set(index, u32::try_from(cell).map_err(io::Error::other)?)?;
            local.set(cell, i32::try_from(index).map_err(io::Error::other)?)?;
            index += 1;
        }
    }
    Ok((cells, local))
}
fn visit_faces(
    mesh: &TriangularLattice,
    length: f64,
    cell: usize,
    local: &Band<i32>,
    mut visit: impl FnMut(usize, f64) -> io::Result<()>,
) -> io::Result<()> {
    for edge in 0..3 {
        let Some(next) = mesh.neighbor(cell, edge) else {
            continue;
        };
        let next = local.get(next)?;
        if next < 0 {
            continue;
        }
        let weight = length.powi(2) * mesh.face_length(cell, edge) / mesh.edge_length(cell, edge);
        visit(next as usize, weight)?;
    }
    Ok(())
}
impl Operator {
    pub fn new(
        mesh: &TriangularLattice,
        coverage: &mut Coverage,
        length: f64,
        active: Option<&ReadBand<u8>>,
    ) -> io::Result<Self> {
        let (cells, local) = metric_cells(mesh, coverage, active)?;
        let count = cells.len();
        let mut offsets = coverage.scratch(count + 1, 0u32);
        let mut faces = 0u32;
        for i in 0..count {
            offsets.set(i, faces)?;
            visit_faces(mesh, length, cells.get(i)? as usize, &local, |_, _| {
                faces = faces.checked_add(1).ok_or_else(|| {
                    io::Error::other("Metric face addresses exceed representation")
                })?;
                Ok(())
            })?;
        }
        offsets.set(count, faces)?;
        let mut areas = coverage.scratch(count, 0.0);
        let mut diagonal = coverage.scratch(count, 0.0);
        let mut neighbors = coverage.scratch(faces as usize, 0u32);
        let mut weights = coverage.scratch(faces as usize, 0.0);
        for i in 0..count {
            let cell = cells.get(i)? as usize;
            let area = mesh.area(cell);
            let mut at = offsets.get(i)? as usize;
            let mut sum = area;
            areas.set(i, area)?;
            visit_faces(mesh, length, cell, &local, |next, weight| {
                neighbors.set(at, next as u32)?;
                weights.set(at, weight)?;
                at += 1;
                sum += weight;
                Ok(())
            })?;
            diagonal.set(i, sum)?;
        }
        Ok(Self {
            count,
            cells: Some(cells),
            areas,
            diagonal,
            offsets,
            neighbors,
            weights,
        })
    }
    pub fn product(&self, values: &ReadBand<f64>, result: &mut Band<f64>) -> io::Result<()> {
        let areas = self.areas.read_only();
        let offsets = self.offsets.read_only();
        let neighbors = self.neighbors.read_only();
        let weights = self.weights.read_only();
        let areas = areas.read_values()?;
        let offsets = offsets.read_values()?;
        let neighbors = neighbors.read_values()?;
        let weights = weights.read_values()?;
        let values = values.read_values()?;
        let mut result = result.write_values()?;
        for i in 0..self.count {
            let value = values.get(i)?;
            let mut sum = value * areas.get(i)?;
            for at in offsets.get(i)?..offsets.get(i + 1)? {
                let at = at as usize;
                sum += (value - values.get(neighbors.get(at)? as usize)?) * weights.get(at)?;
            }
            result.set(i, sum)?;
        }
        Ok(())
    }
}
