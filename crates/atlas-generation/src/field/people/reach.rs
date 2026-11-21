use crate::{
    lattice::TriangularLattice,
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Passage {
    pub passed: Band<f64>,
    pub stride: usize,
    /// Distant pairs the going joins, such as a kept Veil door.
    pub linked: Vec<Joined>,
}
/// A distant pair the going joins: the share of a journey through it that arrives, and the
/// share each end takes in through it beside its neighbours.
#[derive(Clone, Copy, Debug)]
pub struct Joined {
    pub a: usize,
    pub b: usize,
    pub into_a: f64,
    pub into_b: f64,
    pub passed: f64,
}
/// The share of each neighbour edge a cell keeps when `extra` links join it: its edges and
/// links divide what it takes in equally.
pub fn shared_among(stride: usize, extra: usize) -> f64 {
    stride as f64 / (stride + extra) as f64
}
/// Carries what each linked pair holds across the link both ways, into the next sweep.
fn carry_links<T>(
    linked: &[Joined],
    result: &[T],
    next: &mut [T],
    takes: &impl Fn(&mut T, &T, f64),
) {
    for link in linked {
        if link.a < result.len() && link.b < result.len() {
            takes(&mut next[link.a], &result[link.b], link.into_a);
            takes(&mut next[link.b], &result[link.a], link.into_b);
        }
    }
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
        Ok(Self {
            passed,
            stride,
            linked: Vec::new(),
        })
    }
    /// The same going, also joining each link's ends by its cost over `range`, as one more
    /// edge of each end. A cell's edges then share what it can take in among all of them, so
    /// a door's end gathers no more than any other cell.
    pub fn with_links(mut self, links: &[crate::links::Link], range: f64) -> io::Result<Self> {
        let joined: Vec<_> = links
            .iter()
            .map(|link| (link.a, link.b, passed_on(link.cost, range)))
            .filter(|&(_, _, passed)| passed > 0.0)
            .collect();
        let mut ends: Vec<(usize, usize)> = Vec::new();
        for &(a, b, _) in &joined {
            for end in [a, b] {
                match ends.iter_mut().find(|(cell, _)| *cell == end) {
                    Some(entry) => entry.1 += 1,
                    None => ends.push((end, 1)),
                }
            }
        }
        let edges =
            |cell: usize| self.stride + ends.iter().find(|(c, _)| *c == cell).map_or(0, |e| e.1);
        self.linked = joined
            .iter()
            .map(|&(a, b, passed)| Joined {
                a,
                b,
                into_a: passed / edges(a) as f64,
                into_b: passed / edges(b) as f64,
                passed,
            })
            .collect();
        for &(end, extra) in &ends {
            let scale = shared_among(self.stride, extra);
            for edge in 0..self.stride {
                let at = end * self.stride + edge;
                self.passed.set(at, self.passed.get(at)? * scale)?;
            }
        }
        Ok(self)
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
            for link in &self.linked {
                next.set(
                    link.a,
                    next.get(link.a)? + result.get(link.b)? * link.into_a,
                )?;
                next.set(
                    link.b,
                    next.get(link.b)? + result.get(link.a)? * link.into_b,
                )?;
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
            carry_links(&self.linked, &result, &mut next, &takes);
            std::mem::swap(&mut result, &mut next);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::{carry_links, passed_on, passed_over, ranges_of, shared_among, Joined};

    #[test]
    fn a_link_carries_each_end_to_the_other_and_leaves_the_rest() {
        let result = [10.0, 0.0, 0.0, 4.0];
        let mut next = [10.0, 0.0, 0.0, 4.0];
        let link = |a, b, into| Joined {
            a,
            b,
            into_a: into,
            into_b: into,
            passed: into,
        };
        carry_links(
            &[link(0, 3, 0.5), link(1, 9, 1.0)],
            &result,
            &mut next,
            &|into, from, passed| {
                *into += from * passed;
            },
        );
        assert_eq!(next, [12.0, 0.0, 0.0, 9.0]);
    }
    /// The going over the plain test land, with a door between two distant cells.
    fn doored() -> (crate::field::Field, usize, usize, usize) {
        use crate::field::people::fixture::*;
        let field = land(|_, _| {});
        let (west, east, middle) = (
            at(&field, 150.0, 500.0),
            at(&field, 850.0, 500.0),
            at(&field, 500.0, 800.0),
        );
        (field, west, east, middle)
    }
    fn going(field: &crate::field::Field, west: usize, east: usize) -> super::Passage {
        use crate::field::people::{fixture::plain_travel, travel::length};
        let travel = plain_travel(field);
        let range = length(field, 0.03).unwrap();
        let door = crate::links::Link {
            a: west,
            b: east,
            cost: field.mesh.spacing(),
        };
        super::Passage::new(
            &field.mesh,
            &mut field.coverage.borrow_mut(),
            |a, b| travel.step(a, b),
            range,
        )
        .unwrap()
        .with_links(&[door], range)
        .unwrap()
    }
    fn reached(
        field: &crate::field::Field,
        going: &super::Passage,
        amount: impl Fn(usize) -> f64,
    ) -> Vec<f64> {
        let amount = crate::field::people::fixture::band(field, amount);
        let mut result = field.coverage.borrow_mut().scratch(field.mesh.len(), 0.0);
        going
            .reach(
                &field.mesh,
                &mut field.coverage.borrow_mut(),
                &amount,
                &mut result,
                super::REACH_SWEEPS,
            )
            .unwrap();
        (0..field.mesh.len())
            .map(|c| result.get(c).unwrap())
            .collect()
    }
    #[test]
    fn a_door_end_gathers_no_more_of_an_even_country_than_any_cell() {
        let (field, west, east, middle) = doored();
        let going = going(&field, west, east);
        let even = reached(&field, &going, |_| 1.0);
        for end in [west, east] {
            assert!(
                even[end] <= even[middle] * 1.000_001,
                "door end {} against open country {}",
                even[end],
                even[middle]
            );
        }
        assert_eq!(shared_among(3, 0), 1.0);
    }
    #[test]
    fn a_crowd_at_one_door_is_felt_at_the_other() {
        let (field, west, east, middle) = doored();
        let going = going(&field, west, east);
        let crowd = reached(
            &field,
            &going,
            |cell| if cell == west { 1000.0 } else { 0.0 },
        );
        assert!(crowd[east] > 0.0);
        // Far from both ends, nothing of it arrives.
        assert!(crowd[middle] < crowd[east] * 1e-3);
    }

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
