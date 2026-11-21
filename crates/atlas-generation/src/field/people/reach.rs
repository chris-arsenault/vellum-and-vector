use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Passage {
    pub passed: Band<f64>,
    pub stride: usize,
}
/// How many sweeps the travel reach spreads over: food, crowds, contact and routes alike.
pub const REACH_SWEEPS: usize = 48;
/// The cost of one step in ranges, from the share of a journey it passes on: the inverse of
/// `passed_on`, so a route's steps add their costs before they decay.
pub fn ranges_of(passed: f64) -> f64 {
    if passed <= 0.0 {
        f64::INFINITY
    } else {
        (1.0 / passed.min(1.0) - 1.0).max(0.0).sqrt()
    }
}
/// The share of a journey of `ranges` travel ranges that arrives, as `passed_on` decays it.
pub fn passed_over(ranges: f64) -> f64 {
    if ranges.is_finite() {
        1.0 / (1.0 + ranges * ranges)
    } else {
        0.0
    }
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
    /// The same propagation for values that are not one number, such as each tradition's
    /// pressure: every cell starts from its `source` and, each sweep, `takes` what each
    /// neighbour carries, passed on along the edge between them.
    pub fn reach_each<T: Clone>(
        &self,
        mesh: &TriangularLattice,
        source: &[T],
        sweeps: usize,
        takes: impl Fn(&mut T, &T, f64),
    ) -> io::Result<Vec<T>> {
        let mut result = source.to_vec();
        let mut next = source.to_vec();
        for _ in 0..sweeps {
            for (cell, into) in next.iter_mut().enumerate() {
                *into = source[cell].clone();
                for edge in 0..self.stride {
                    if let Some(other) = mesh.neighbor(cell, edge) {
                        takes(
                            into,
                            &result[other],
                            self.passed.get(cell * self.stride + edge)?,
                        );
                    }
                }
            }
            std::mem::swap(&mut result, &mut next);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::{passed_on, passed_over, ranges_of};

    #[test]
    fn a_route_of_steps_decays_like_one_journey_of_their_summed_cost() {
        let step = passed_on(1.0, 2.0);
        assert!((passed_over(ranges_of(step)) - step).abs() < 1e-12);
        let four = passed_over(4.0 * ranges_of(step));
        assert!((four - passed_on(4.0, 2.0)).abs() < 1e-12);
        // Squared costs add before decaying, so a long route passes on less than its steps'
        // product would claim.
        assert!(four < step.powi(4));
        assert_eq!(passed_over(ranges_of(0.0)), 0.0);
    }
}
