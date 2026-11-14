use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Passage {
    pub passed: Band<f64>,
    pub stride: usize,
}
pub fn passed_on(cost: f64, range: f64) -> f64 {
    if cost.is_finite() {
        1.0 / (1.0 + cost * cost / (range * range))
    } else {
        0.0
    }
}
impl Passage {
    pub fn new(
        mesh: &TriangularLattice,
        coverage: &mut Coverage,
        step: impl Fn(usize, usize) -> io::Result<f64>,
        range: f64,
    ) -> io::Result<Self> {
        let stride = 3;
        let mut passed = coverage.scratch(mesh.len() * stride, 0.0);
        for cell in 0..mesh.len() {
            for edge in 0..stride {
                if let Some(next) = mesh.neighbor(cell, edge) {
                    passed.set(
                        cell * stride + edge,
                        passed_on(step(next, cell)?.max(step(cell, next)?), range) / stride as f64,
                    )?;
                }
            }
        }
        Ok(Self { passed, stride })
    }
    /// The original bounded propagation pass, shared by food, crowds and identity.
    pub fn reach(
        &self,
        mesh: &TriangularLattice,
        coverage: &mut Coverage,
        amount: &ReadBand<f64>,
        result: &mut Band<f64>,
        sweeps: usize,
    ) -> io::Result<()> {
        let mut next = coverage.scratch(mesh.len(), 0.0);
        for cell in 0..mesh.len() {
            result.set(cell, amount.get(cell)?)?;
        }
        for _ in 0..sweeps {
            for cell in 0..mesh.len() {
                let mut arriving = 0.0;
                for edge in 0..self.stride {
                    if let Some(other) = mesh.neighbor(cell, edge) {
                        arriving +=
                            result.get(other)? * self.passed.get(cell * self.stride + edge)?;
                    }
                }
                next.set(cell, amount.get(cell)? + arriving)?;
            }
            for cell in 0..mesh.len() {
                result.set(cell, next.get(cell)?)?;
            }
        }
        Ok(())
    }
}
