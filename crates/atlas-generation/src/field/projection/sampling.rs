//! Shared fan weights from world/atlasSampling.ts; identities keep their complete donor.
use crate::{
    lattice::{sampling::vertex_members, TriangularLattice, BLOCK_CELLS},
    storage::{Band, Coverage, ReadBand, Sample},
};
use std::io;

const STRIDE: usize = 8;
const SAMPLES_PER_BLOCK: usize = 4096;
pub struct Interpolation {
    samples: Band<i32>,
    degree: Band<u8>,
    cells: Band<i32>,
    weights: Band<f64>,
}
impl Interpolation {
    pub fn new(
        mesh: &TriangularLattice,
        count: usize,
        position: impl Fn(usize) -> io::Result<[f64; 2]>,
        coverage: &mut Coverage,
    ) -> io::Result<Self> {
        let slots = count
            .checked_mul(STRIDE)
            .ok_or_else(|| io::Error::other("Projection exceeds address representation"))?;
        let mut result = Self {
            samples: coverage.scratch(count, -1i32),
            degree: coverage.scratch(count, 0u8),
            cells: coverage.scratch(slots, 0i32),
            weights: coverage.scratch(slots, 0.0),
        };
        for start in (0..count).step_by(SAMPLES_PER_BLOCK) {
            let length = SAMPLES_PER_BLOCK.min(count - start);
            let mut samples = vec![-1; length];
            let mut degree = vec![0; length];
            let mut cells = vec![0; length * STRIDE];
            let mut weights = vec![0.0; length * STRIDE];
            for i in 0..length {
                let p = position(start + i)?;
                let [x, y] = mesh.point(p[0], p[1]);
                let Some(cell) = mesh.cell_at(x, y) else {
                    continue;
                };
                samples[i] = i32::try_from(cell)
                    .map_err(|_| io::Error::other("Projection donor exceeds int32"))?;
                let row = i * STRIDE;
                degree[i] = fan(
                    mesh,
                    cell,
                    [x, y],
                    &mut cells[row..row + STRIDE],
                    &mut weights[row..row + STRIDE],
                ) as u8;
            }
            write_range(&mut result.samples, start, &samples)?;
            write_range(&mut result.degree, start, &degree)?;
            write_range(&mut result.cells, start * STRIDE, &cells)?;
            write_range(&mut result.weights, start * STRIDE, &weights)?;
        }
        result.samples.retain();
        result.degree.retain();
        result.cells.retain();
        result.weights.retain();
        Ok(result)
    }
    pub fn samples(&self) -> ReadBand<i32> {
        self.samples.read_only()
    }
    pub fn project(
        &self,
        read: &dyn Fn(usize) -> io::Result<f64>,
        discrete: bool,
        mut write: impl FnMut(usize, &[f64]) -> io::Result<()>,
    ) -> io::Result<()> {
        for start in (0..self.samples.len()).step_by(SAMPLES_PER_BLOCK) {
            let count = SAMPLES_PER_BLOCK.min(self.samples.len() - start);
            let mut result = vec![0.0; count];
            if discrete {
                let donors = read_range(&self.samples, start, count)?;
                for (value, donor) in result.iter_mut().zip(donors) {
                    *value = read(
                        usize::try_from(donor)
                            .map_err(|_| io::Error::other("Discrete projection has no donor"))?,
                    )?;
                }
            } else {
                let degree = read_range(&self.degree, start, count)?;
                let cells = read_range(&self.cells, start * STRIDE, count * STRIDE)?;
                let weights = read_range(&self.weights, start * STRIDE, count * STRIDE)?;
                for i in 0..count {
                    if degree[i] == 0 {
                        continue;
                    }
                    let row = i * STRIDE;
                    let base = read(cells[row] as usize)?;
                    let mut delta = 0.0;
                    for j in 0..degree[i] as usize {
                        delta += weights[row + j] * (read(cells[row + j] as usize)? - base);
                    }
                    result[i] = base + delta;
                }
            }
            write(start, &result)?;
        }
        Ok(())
    }
}
fn fan(
    mesh: &TriangularLattice,
    cell: usize,
    p: [f64; 2],
    cells: &mut [i32],
    weights: &mut [f64],
) -> usize {
    let barycentric = mesh.barycentric(cell, p);
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
    let edge = if mesh.inverted(cell) && opposite > 0 {
        3 - opposite
    } else {
        opposite
    };
    cells[0] = cell as i32;
    cells[1] = mesh.neighbor(cell, edge).unwrap_or(cell) as i32;
    weights[0] = center + face / 2.0;
    weights[1] = face / 2.0;
    let members = vertex_members(mesh, cell, corner);
    let count = members.len() + 2;
    for (i, &member) in members.iter().enumerate() {
        cells[i + 2] = member as i32;
        weights[i + 2] = vertex / members.len() as f64;
    }
    let sum: f64 = weights[..count].iter().sum();
    for weight in &mut weights[..count] {
        *weight /= sum;
    }
    count
}
pub(super) fn write_range<T: Sample>(
    band: &mut Band<T>,
    start: usize,
    values: &[T],
) -> io::Result<()> {
    let mut offset = 0;
    while offset < values.len() {
        let at = start + offset;
        let length = (BLOCK_CELLS - at % BLOCK_CELLS).min(values.len() - offset);
        band.with_block_mut(at / BLOCK_CELLS, |block| {
            block[at % BLOCK_CELLS..at % BLOCK_CELLS + length]
                .copy_from_slice(&values[offset..offset + length]);
        })?;
        offset += length;
    }
    Ok(())
}
fn read_range<T: Sample>(band: &Band<T>, start: usize, count: usize) -> io::Result<Vec<T>> {
    let read = band.read_only();
    let mut result = Vec::with_capacity(count);
    let mut at = start;
    while at < start + count {
        let length = (BLOCK_CELLS - at % BLOCK_CELLS).min(start + count - at);
        read.with_block(at / BLOCK_CELLS, |block| {
            result.extend_from_slice(&block[at % BLOCK_CELLS..at % BLOCK_CELLS + length]);
        })?;
        at += length;
    }
    Ok(result)
}
