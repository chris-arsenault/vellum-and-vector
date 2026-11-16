use super::super::Field;
use crate::{
    lattice::{sampling::Sampler, TriangularLattice},
    noise::fractal_noise,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    storage::ReadBand,
};
use std::io;

pub struct Adjacency {
    offsets: Vec<usize>,
    neighbors: Vec<usize>,
    weights: Vec<f64>,
    rate: Vec<f64>,
    step: f64,
}
impl Adjacency {
    pub fn new(mesh: &TriangularLattice) -> Self {
        let step = (0..mesh.len())
            .map(|_| mesh.cell_width().min(mesh.cell_height()))
            .fold(f64::INFINITY, f64::min);
        let mut result = Self {
            offsets: Vec::with_capacity(mesh.len() + 1),
            neighbors: Vec::new(),
            weights: Vec::new(),
            rate: vec![0.0; mesh.len()],
            step,
        };
        for cell in 0..mesh.len() {
            result.offsets.push(result.neighbors.len());
            let mut total = 0.0;
            for edge in 0..3 {
                let Some(next) = mesh.neighbor(cell, edge) else {
                    continue;
                };
                let length = mesh.edge_length(cell, edge);
                let weight = if length > 0.0 {
                    mesh.face_length(cell, edge) / length
                } else {
                    0.0
                };
                result.neighbors.push(next);
                result.weights.push(weight);
                total += weight;
            }
            if total > 0.0 {
                result.rate[cell] = (step * step / (8.0 * mesh.area(cell))).min(1.0 / total);
            }
        }
        result.offsets.push(result.neighbors.len());
        result
    }
    pub fn smooth(&self, values: &mut [f64], sigma: f64, within: Option<&[u8]>) {
        if sigma <= 0.0 {
            return;
        }
        let passes = (4.0 * sigma * sigma / (self.step * self.step))
            .ceil()
            .max(1.0) as usize;
        let mut previous = values.to_vec();
        for _ in 0..passes {
            previous.copy_from_slice(values);
            for cell in 0..values.len() {
                if self.rate[cell] <= 0.0 || within.is_some_and(|mask| mask[cell] == 0) {
                    continue;
                }
                let mut flux = 0.0;
                for at in self.offsets[cell]..self.offsets[cell + 1] {
                    let next = self.neighbors[at];
                    if within.is_none_or(|mask| mask[next] != 0) {
                        flux += self.weights[at] * (previous[next] - previous[cell]);
                    }
                }
                values[cell] = previous[cell] + self.rate[cell] * flux;
            }
        }
    }
}
impl Field {
    pub fn smoothed_captured_base(
        &self,
        inherited: &ReadBand<f64>,
        parent_span: f64,
        datum: f64,
        seed: i32,
    ) -> io::Result<Vec<f64>> {
        let mut at = Sampler::new(&self.mesh);
        let bounds = self.mesh.bounds();
        let wavelength = self.scale.supported(parent_span, 4.0);
        let shelf = self
            .scale
            .resolve(RelativeMeasure::length(0.0000075).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .value();
        let mut sampled = vec![0.0; self.mesh.len()];
        let mut clamped = vec![0.0; self.mesh.len()];
        for cell in 0..self.mesh.len() {
            let [x, y] = self.mesh.position(cell);
            let [ox, oy] = self.mesh.origin();
            let wx = fractal_noise(x + ox, y + oy, seed ^ 0x51a3, wavelength * 2.0, 2);
            let wy = fractal_noise(x + ox, y + oy, seed ^ 0x7c4b, wavelength * 2.0, 2);
            sampled[cell] = at.sample(
                [
                    (x + wx * wavelength * 0.18).clamp(bounds.0, bounds.2),
                    (y + wy * wavelength * 0.18).clamp(bounds.1, bounds.3),
                ],
                |i| Ok(MapScale::metres(inherited.get(i)?, LengthUnit::Native) - datum),
            )?;
            clamped[cell] = sampled[cell].max(-shelf);
        }
        let adjacency = Adjacency::new(&self.mesh);
        adjacency.smooth(&mut clamped, parent_span * 0.15, None);
        adjacency.smooth(&mut sampled, parent_span * 0.15, None);
        for cell in 0..self.mesh.len() {
            if clamped[cell] < 0.0 {
                clamped[cell] = clamped[cell].min(sampled[cell]);
            }
        }
        Ok(clamped)
    }
}
