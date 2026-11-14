use super::{
    corner_values::Values,
    fit::Fits,
    hermite::{self, Patch},
    topology::{Topology, Vertex},
};
use crate::storage::{Band, Coverage};
use std::io;
pub struct Adaptive<'a> {
    topology: &'a Topology,
    fits: Fits,
    patches: Band<f64>,
    ready: Band<u8>,
    vertices: Values<4>,
    bases: Values<1>,
}
impl<'a> Adaptive<'a> {
    pub fn new(topology: &'a Topology, coverage: &mut Coverage) -> Self {
        let count = topology.leaves.len();
        Self {
            topology,
            fits: Fits::new(count, coverage),
            patches: coverage.scratch(count * 19, 0.0),
            ready: coverage.scratch(count, 0),
            vertices: Values::new(count, coverage),
            bases: Values::new(count, coverage),
        }
    }
    pub fn sample(
        &mut self,
        point: [f64; 2],
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        let Some(cell) = self.topology.at(point)? else {
            return Ok(f64::NAN);
        };
        let b = self.topology.cell(cell)?;
        Ok(self.patch(cell, read)?.sample(
            (point[0] - b[0]) / (b[2] - b[0]),
            (point[1] - b[1]) / (b[3] - b[1]),
        ))
    }
    pub(super) fn patch(
        &mut self,
        cell: usize,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<Patch> {
        let at = cell * 19;
        if self.ready.get(cell)? == 0 {
            let patch = self.prepare(cell, read)?;
            for (i, value) in patch.coefficients.into_iter().enumerate() {
                self.patches.set(at + i, value)?;
            }
            self.patches.set(at + 16, patch.correction)?;
            self.patches.set(at + 17, patch.low)?;
            self.patches.set(at + 18, patch.high)?;
            self.ready.set(cell, 1)?;
            return Ok(patch);
        }
        let mut coefficients = [0.0; 16];
        for (i, value) in coefficients.iter_mut().enumerate() {
            *value = self.patches.get(at + i)?;
        }
        Ok(Patch {
            coefficients,
            correction: self.patches.get(at + 16)?,
            low: self.patches.get(at + 17)?,
            high: self.patches.get(at + 18)?,
        })
    }
    fn prepare(
        &mut self,
        cell: usize,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<Patch> {
        let [x0, y0, x1, y1] = self.topology.cell(cell)?;
        let width = x1 - x0;
        let height = y1 - y0;
        let epsilon = width.min(height) * 1e-6;
        let mut c = [0.0; 16];
        for (corner, point) in [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]
            .into_iter()
            .enumerate()
        {
            let vertex = self.topology.corner(cell, point, epsilon)?;
            let v = self.vertex(&vertex, read)?;
            c[corner * 4..corner * 4 + 4].copy_from_slice(&[
                v[0],
                v[1] * width,
                v[2] * height,
                v[3] * width * height,
            ]);
        }
        Ok(Patch::new(c, read(cell)?))
    }
    fn vertex(
        &mut self,
        vertex: &Vertex,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<[f64; 4]> {
        let key = self.topology.vertex_key(vertex)?;
        if let Some(value) = self.vertices.get(key, vertex.epsilon)? {
            return Ok(value);
        }
        let value = if let Some(cell) = vertex.hanging {
            let b = self.topology.cell(cell)?;
            let c = self.patch(cell, read)?.coefficients;
            let width = b[2] - b[0];
            let height = b[3] - b[1];
            let u = (vertex.point[0] - b[0]) / width;
            let v = (vertex.point[1] - b[1]) / height;
            [
                hermite::polynomial(&c, u, v, false, false),
                hermite::polynomial(&c, u, v, true, false) / width,
                hermite::polynomial(&c, u, v, false, true) / height,
                hermite::polynomial(&c, u, v, true, true) / (width * height),
            ]
        } else {
            self.unconstrained(vertex, read)?
        };
        self.vertices.put(key, vertex.epsilon, value)?;
        Ok(value)
    }
    fn unconstrained(
        &mut self,
        vertex: &Vertex,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<[f64; 4]> {
        let [x, y] = vertex.point;
        let mut result = [self.base(vertex, read)?, 0.0, 0.0, 0.0];
        let mut weight = 0.0;
        for &cell in &vertex.cells {
            let b = self.topology.cell(cell)?;
            let w = 1.0 / ((b[2] - b[0]) * (b[3] - b[1]));
            let g = self.fits.at(self.topology, read, cell)?;
            let dx = x - (b[0] + b[2]) / 2.0;
            let dy = y - (b[1] + b[3]) / 2.0;
            result[1] += w * (g[0] + 2.0 * g[2] * dx + g[3] * dy);
            result[2] += w * (g[1] + g[3] * dx + 2.0 * g[4] * dy);
            result[3] += w * g[3];
            weight += w;
        }
        for value in &mut result[1..] {
            *value /= weight;
        }
        self.limit(vertex, read, &mut result)?;
        Ok(result)
    }
    fn limit(
        &mut self,
        vertex: &Vertex,
        read: &dyn Fn(usize) -> io::Result<f64>,
        result: &mut [f64; 4],
    ) -> io::Result<()> {
        let [x, y] = vertex.point;
        for &cell in &vertex.cells {
            let b = self.topology.cell(cell)?;
            for (point, axis, distance) in [
                (
                    [if x == b[0] { b[2] } else { b[0] }, y],
                    1,
                    if x == b[0] { b[2] - x } else { b[0] - x },
                ),
                (
                    [x, if y == b[1] { b[3] } else { b[1] }],
                    2,
                    if y == b[1] { b[3] - y } else { b[1] - y },
                ),
            ] {
                let other = self.topology.corner(cell, point, vertex.epsilon)?;
                let secant = (self.base(&other, read)? - result[0]) / distance;
                result[axis] = if result[axis] * secant <= 0.0 {
                    0.0
                } else {
                    secant.signum() * result[axis].abs().min(3.0 * secant.abs())
                };
            }
        }
        Ok(())
    }
    fn base(
        &mut self,
        vertex: &Vertex,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        let key = self.topology.vertex_key(vertex)?;
        if let Some([value]) = self.bases.get(key, vertex.epsilon)? {
            return Ok(value);
        }
        let value = self.prepare_base(vertex, read)?;
        self.bases.put(key, vertex.epsilon, [value])?;
        Ok(value)
    }
    fn prepare_base(
        &mut self,
        vertex: &Vertex,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        if let Some(cell) = vertex.coarse {
            return self.constrained(vertex, cell, read);
        }
        let [x, y] = vertex.point;
        let mut sum = 0.0;
        let mut weight = 0.0;
        let mut low = f64::INFINITY;
        let mut high = f64::NEG_INFINITY;
        for &cell in &vertex.cells {
            let b = self.topology.cell(cell)?;
            let g = self.fits.at(self.topology, read, cell)?;
            let w = 1.0 / ((b[2] - b[0]) * (b[3] - b[1]));
            let dx = x - (b[0] + b[2]) / 2.0;
            let dy = y - (b[1] + b[3]) / 2.0;
            let value = read(cell)?;
            sum += w
                * (value
                    + g[0] * dx
                    + g[1] * dy
                    + g[2] * dx * dx
                    + g[3] * dx * dy
                    + g[4] * dy * dy);
            weight += w;
            low = low.min(value);
            high = high.max(value);
        }
        let value = sum / weight;
        let b = self.topology.bounds;
        Ok(if x <= b[0] || x >= b[2] || y <= b[1] || y >= b[3] {
            value
        } else {
            value.max(low).min(high)
        })
    }
    fn constrained(
        &mut self,
        vertex: &Vertex,
        cell: usize,
        read: &dyn Fn(usize) -> io::Result<f64>,
    ) -> io::Result<f64> {
        let [x, y] = vertex.point;
        let b = self.topology.cell(cell)?;
        let vertical = x == b[0] || x == b[2];
        let from = if vertical { [x, b[1]] } else { [b[0], y] };
        let to = if vertical { [x, b[3]] } else { [b[2], y] };
        let a = self.base(&self.topology.corner(cell, from, vertex.epsilon)?, read)?;
        let z = self.base(&self.topology.corner(cell, to, vertex.epsilon)?, read)?;
        let length = if vertical { b[3] - b[1] } else { b[2] - b[0] };
        let fraction = if vertical {
            (y - b[1]) / length
        } else {
            (x - b[0]) / length
        };
        Ok(a + (z - a) * fraction
            - self.fits.at(self.topology, read, cell)?[if vertical { 4 } else { 2 }]
                * length
                * length
                * fraction
                * (1.0 - fraction))
    }
}
