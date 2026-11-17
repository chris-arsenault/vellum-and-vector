//! Reconstruct retained class contributions before selecting a crisp class colour.
use super::{cubic, Sampler, Surface};
use crate::field::projection::support;
use std::io;

struct Coefficient {
    code: i32,
    values: [[f64; 4]; 4],
}
pub(super) struct Window {
    cells: [[usize; 4]; 4],
    coefficients: smallvec::SmallVec<[Coefficient; 16]>,
}
impl Window {
    fn new(source: &Surface<'_>, cells: [[usize; 4]; 4]) -> io::Result<Self> {
        let mut coefficients: smallvec::SmallVec<[Coefficient; 16]> = smallvec::SmallVec::new();
        let evidence = source.support.as_ref().expect("retained contributions");
        for (y, row) in cells.iter().enumerate() {
            for (x, &cell) in row.iter().enumerate() {
                if source.active.get(cell)? == 0 {
                    continue;
                }
                support::visit(evidence, cell, |code, weight| {
                    let slot = match coefficients.iter().position(|c| c.code == code) {
                        Some(slot) => slot,
                        None => {
                            coefficients.push(Coefficient {
                                code,
                                values: [[0.0; 4]; 4],
                            });
                            coefficients.len() - 1
                        }
                    };
                    coefficients[slot].values[y][x] += weight;
                })?;
            }
        }
        Ok(Self {
            cells,
            coefficients,
        })
    }
    fn sample(
        &self,
        wx: [f64; 4],
        wy: [f64; 4],
        nearest: i32,
        includes: Option<&dyn Fn(i32) -> bool>,
    ) -> f64 {
        let (mut best, mut score, mut inside, mut outside) =
            (nearest, f64::NEG_INFINITY, 0.0f64, 0.0f64);
        for coefficient in &self.coefficients {
            let value: f64 = coefficient
                .values
                .iter()
                .zip(wy)
                .map(|(row, y)| row.iter().zip(wx).map(|(v, x)| v * x * y).sum::<f64>())
                .sum();
            if let Some(includes) = includes {
                if includes(coefficient.code) {
                    inside = inside.max(value);
                } else {
                    outside = outside.max(value);
                }
            }
            let code = coefficient.code;
            if value > score
                || (value == score && (code == nearest || (best != nearest && code < best)))
            {
                best = code;
                score = value;
            }
        }
        includes.map_or(f64::from(best), |_| inside - outside)
    }
}
impl Sampler<'_> {
    pub(super) fn weighted_raster(
        &self,
        cells: [[usize; 4]; 4],
        tx: f64,
        ty: f64,
        nearest: i32,
        includes: Option<&dyn Fn(i32) -> bool>,
    ) -> io::Result<f64> {
        let mut cache = self.support_window.borrow_mut();
        if cache.as_ref().is_none_or(|window| window.cells != cells) {
            *cache = Some(Window::new(&self.source, cells)?);
        }
        Ok(cache.as_ref().expect("prepared window").sample(
            cubic::weights(tx),
            cubic::weights(ty),
            nearest,
            includes,
        ))
    }
}
impl Surface<'_> {
    pub(super) fn membership(&self, cell: usize, code: i32) -> io::Result<f64> {
        if self.active.get(cell)? == 0 {
            return Ok(0.0);
        }
        if let Some(evidence) = &self.support {
            let mut value = 0.0;
            support::visit(evidence, cell, |member, weight| {
                if member == code {
                    value += weight;
                }
            })?;
            Ok(value)
        } else {
            Ok(f64::from(self.values.get(cell)? as i32 == code))
        }
    }
}
