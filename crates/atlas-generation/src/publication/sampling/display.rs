//! The current regular-grid PCHIP display surface; physical readings remain unchanged.
use crate::{field::inheritance::resources::Resource, reconstruction::Layout};
use std::io;

fn tangent(a: f64, b: f64) -> f64 {
    if a * b > 0.0 {
        2.0 * a * b / (a + b)
    } else {
        0.0
    }
}
fn cubic([a, b, c, d]: [f64; 4], t: f64, first: bool, last: bool) -> f64 {
    let delta = c - b;
    let left = if first { delta } else { tangent(b - a, delta) };
    let right = if last { delta } else { tangent(delta, d - c) };
    b + t * (left + t * (3.0 * delta - 2.0 * left - right + t * (left + right - 2.0 * delta)))
}
pub struct Display<'a> {
    source: &'a Resource,
    previous: Option<usize>,
    held: Option<[[f64; 4]; 4]>,
}
impl<'a> Display<'a> {
    pub fn new(source: &'a Resource) -> Self {
        Self {
            source,
            previous: None,
            held: None,
        }
    }
    pub fn sample(&mut self, point: [f64; 2], fallback: f64) -> io::Result<f64> {
        let Layout::Raster { width, height } = self.source.grid.layout else {
            return Ok(fallback);
        };
        if width < 2 || height < 2 {
            return Ok(fallback);
        }
        let [w, s, e, n] = self.source.grid.bounds;
        let x = ((point[0] - w) / (e - w) * (width - 1) as f64).clamp(0.0, (width - 1) as f64);
        let y = ((point[1] - s) / (n - s) * (height - 1) as f64).clamp(0.0, (height - 1) as f64);
        let col = (x.floor() as usize).min(width - 2);
        let row = (y.floor() as usize).min(height - 2);
        if self.previous != Some(row * width + col) {
            self.previous = Some(row * width + col);
            self.held = self.samples(col, row, width, height)?;
        }
        let Some(samples) = self.held else {
            return Ok(fallback);
        };
        let mut rows = [0.0; 4];
        for (j, into) in rows.iter_mut().enumerate() {
            *into = cubic(samples[j], x - col as f64, col == 0, col == width - 2);
        }
        Ok(cubic(rows, y - row as f64, row == 0, row == height - 2))
    }
    fn samples(
        &self,
        col: usize,
        row: usize,
        width: usize,
        height: usize,
    ) -> io::Result<Option<[[f64; 4]; 4]>> {
        let values = &self.source.channels["Elevation"].values;
        let mut samples = [[0.0; 4]; 4];
        for (j, samples) in samples.iter_mut().enumerate() {
            for (i, sample) in samples.iter_mut().enumerate() {
                let cell = (row + j).saturating_sub(1).min(height - 1) * width
                    + (col + i).saturating_sub(1).min(width - 1);
                *sample = values.get(cell)?;
                if self.source.active.get(cell)? == 0 || !sample.is_finite() {
                    return Ok(None);
                }
            }
        }
        Ok(Some(samples))
    }
}
