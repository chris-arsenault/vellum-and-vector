use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand, ReadValues},
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
    let active = active.map(ReadBand::read_values).transpose()?;
    let included = |cell| -> io::Result<bool> {
        Ok(active
            .as_ref()
            .map(|a| a.get(cell))
            .transpose()?
            .unwrap_or(1)
            != 0)
    };
    let mut count = 0;
    for cell in 0..mesh.len() {
        if included(cell)? {
            count += 1;
        }
    }
    let mut cells = coverage.scratch(count, 0u32);
    let mut local = coverage.scratch(mesh.len(), -1i32);
    let mut cell_values = cells.write_values()?;
    let mut local_values = local.write_values()?;
    let mut index = 0;
    for cell in 0..mesh.len() {
        if included(cell)? {
            cell_values.set(index, u32::try_from(cell).map_err(io::Error::other)?)?;
            local_values.set(cell, i32::try_from(index).map_err(io::Error::other)?)?;
            index += 1;
        }
    }
    drop((cell_values, local_values));
    Ok((cells, local))
}
fn visit_faces(
    mesh: &TriangularLattice,
    length: f64,
    cell: usize,
    local: &ReadValues<'_, i32>,
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
        let cell_values = cells.read_values()?;
        let local = local.read_values()?;
        let mut offsets = coverage.scratch(count + 1, 0u32);
        let mut faces = 0u32;
        let mut offset_values = offsets.write_values()?;
        for i in 0..count {
            offset_values.set(i, faces)?;
            visit_faces(
                mesh,
                length,
                cell_values.get(i)? as usize,
                &local,
                |_, _| {
                    faces = faces.checked_add(1).ok_or_else(|| {
                        io::Error::other("Metric face addresses exceed representation")
                    })?;
                    Ok(())
                },
            )?;
        }
        offset_values.set(count, faces)?;
        drop(offset_values);
        let mut areas = coverage.scratch(count, 0.0);
        let mut diagonal = coverage.scratch(count, 0.0);
        let mut neighbors = coverage.scratch(faces as usize, 0u32);
        let mut weights = coverage.scratch(faces as usize, 0.0);
        let offsets_view = offsets.read_values()?;
        let mut area_values = areas.write_values()?;
        let mut diagonal_values = diagonal.write_values()?;
        let mut neighbor_values = neighbors.write_values()?;
        let mut weight_values = weights.write_values()?;
        for i in 0..count {
            let cell = cell_values.get(i)? as usize;
            let area = mesh.area(cell);
            let mut at = offsets_view.get(i)? as usize;
            let mut sum = area;
            area_values.set(i, area)?;
            visit_faces(mesh, length, cell, &local, |next, weight| {
                neighbor_values.set(at, next as u32)?;
                weight_values.set(at, weight)?;
                at += 1;
                sum += weight;
                Ok(())
            })?;
            diagonal_values.set(i, sum)?;
        }
        drop((
            cell_values,
            offsets_view,
            area_values,
            diagonal_values,
            neighbor_values,
            weight_values,
        ));
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
        if values.len() != self.count || result.len() != self.count {
            return Err(io::Error::other(
                "Metric vector shape does not match operator",
            ));
        }
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
        if let (
            Some(areas),
            Some(offsets),
            Some(neighbors),
            Some(weights),
            Some(values),
            Some(result),
        ) = (
            areas.as_slice(),
            offsets.as_slice(),
            neighbors.as_slice(),
            weights.as_slice(),
            values.as_slice(),
            result.as_mut_slice(),
        ) {
            return resident_product(areas, offsets, neighbors, weights, values, result);
        }
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

/// Resident arrays dispatch once per kernel; paged arrays keep the same CSR operation above.
fn resident_product(
    areas: &[f64],
    offsets: &[u32],
    neighbors: &[u32],
    weights: &[f64],
    values: &[f64],
    result: &mut [f64],
) -> io::Result<()> {
    if values.len() != areas.len() || result.len() != areas.len() {
        return Err(io::Error::other(
            "Metric vector shape does not match operator",
        ));
    }
    let row = |i: usize| {
        let value = values[i];
        let mut sum = value * areas[i];
        for at in offsets[i] as usize..offsets[i + 1] as usize {
            sum += (value - values[neighbors[at] as usize]) * weights[at];
        }
        sum
    };
    // Each row reads only the input vector, so native rows run on every core; each row's
    // sum is the same whichever thread computes it.
    #[cfg(not(target_arch = "wasm32"))]
    {
        use rayon::prelude::*;
        result
            .par_iter_mut()
            .enumerate()
            .with_min_len(4096)
            .for_each(|(i, output)| *output = row(i));
    }
    #[cfg(target_arch = "wasm32")]
    for (i, output) in result.iter_mut().enumerate() {
        *output = row(i);
    }
    Ok(())
}
