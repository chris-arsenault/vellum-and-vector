//! Priority flood keeps physical fill height separate from the work of a flat corridor.
use crate::{
    hpc::{Direction, MultiKeyHeap},
    lattice::TriangularLattice,
    noise::{hash_unit, world_noise},
    storage::{Band, Coverage, ReadBand},
};
use std::io;

pub struct Drainage {
    pub(super) parents: Band<i32>,
    pub(super) ranks: Band<i32>,
    pub(super) elevations: Band<f64>,
    pub(super) guidance: Band<i32>,
    pub flood_fill_total: u64,
    pub flood_flat_fill_total: u64,
    pub decision_total: u64,
    pub tie_decision_total: u64,
}
pub struct DrainageView {
    pub parents: ReadBand<i32>,
    pub ranks: ReadBand<i32>,
    pub elevations: ReadBand<f64>,
    pub guidance: ReadBand<i32>,
}
pub struct Conditioning<'a> {
    pub mesh: &'a TriangularLattice,
    pub water_kind: &'a ReadBand<u8>,
    pub bed: &'a dyn Fn(usize) -> io::Result<f64>,
    pub incoming: Option<&'a ReadBand<f64>>,
    pub open_boundary: bool,
    pub seed: i32,
    pub neighborhood_radius: f64,
    pub response: &'a dyn Fn(usize, usize) -> io::Result<f64>,
}
struct Frontier {
    priorities: Band<f64>,
    costs: Band<f64>,
    bed: Band<f64>,
    resistance: Band<f64>,
    queue: MultiKeyHeap<3>,
}
impl Drainage {
    pub fn new(coverage: &mut Coverage) -> Self {
        Self {
            parents: coverage.allocate(-1),
            ranks: coverage.allocate(0),
            elevations: coverage.allocate(0.0),
            guidance: coverage.allocate(-1),
            flood_fill_total: 0,
            flood_flat_fill_total: 0,
            decision_total: 0,
            tie_decision_total: 0,
        }
    }
    pub fn read_only(&self) -> DrainageView {
        DrainageView {
            parents: self.parents.read_only(),
            ranks: self.ranks.read_only(),
            elevations: self.elevations.read_only(),
            guidance: self.guidance.read_only(),
        }
    }
    pub fn condition(
        &mut self,
        input: Conditioning<'_>,
        coverage: &mut Coverage,
    ) -> io::Result<()> {
        let n = input.mesh.len();
        let mut priorities = coverage.scratch(n, f64::INFINITY);
        let mut costs = coverage.scratch(n, f64::INFINITY);
        let mut bed = coverage.scratch(n, 0.0);
        let mut resistance = coverage.scratch(n, 0.0);
        for cell in 0..n {
            self.parents.set(cell, -1)?;
            self.ranks.set(cell, -1)?;
            bed.set(cell, (input.bed)(cell)?)?;
            let [x, y] = input.mesh.position(cell);
            let [ox, oy] = input.mesh.origin();
            let value = (world_noise(
                input.mesh,
                x + ox,
                y + oy,
                input.seed ^ 0x1f7d,
                input.neighborhood_radius,
                2,
            ) + 1.0)
                * 0.5;
            resistance.set(
                cell,
                if value < 0.37 {
                    1.0
                } else {
                    12.0 + 7.0 * value
                },
            )?;
        }
        let mut queue = MultiKeyHeap::new([Direction::Ascending; 3], Direction::Ascending);
        seed_outlets(&input, |cell| {
            self.ranks.set(cell, i32::MAX)?;
            priorities.set(cell, bed.get(cell)?)?;
            costs.set(cell, 0.0)?;
            queue.push(cell as u32, [bed.get(cell)?, 0.0, 0.0]);
            Ok(())
        })?;
        if queue.is_empty() {
            return Err(io::Error::other(
                "Priority flood requires a connected ocean outlet",
            ));
        }
        let mut frontier = Frontier {
            priorities,
            costs,
            bed,
            resistance,
            queue,
        };
        let mut rank = 0;
        while let Some((cell, [priority, cost, _])) = frontier.queue.pop() {
            let cell = cell as usize;
            if priority != frontier.priorities.get(cell)?
                || cost != frontier.costs.get(cell)?
                || self.ranks.get(cell)? < n as i32
            {
                continue;
            }
            self.ranks.set(cell, rank)?;
            rank += 1;
            self.elevations.set(cell, priority)?;
            for edge in 0..3 {
                let Some(next) = input.mesh.neighbor(cell, edge) else {
                    continue;
                };
                self.enqueue(&input, &mut frontier, (cell, priority, cost), (next, edge))?;
            }
        }
        if rank as usize != n {
            return Err(io::Error::other(
                "Priority flood did not visit the complete physical graph",
            ));
        }
        Ok(())
    }
    fn enqueue(
        &mut self,
        input: &Conditioning<'_>,
        frontier: &mut Frontier,
        (cell, priority, cost): (usize, f64, f64),
        (next, edge): (usize, usize),
    ) -> io::Result<()> {
        let Frontier {
            priorities,
            costs,
            bed,
            resistance,
            queue,
        } = frontier;
        let next_rank = self.ranks.get(next)?;
        if next_rank >= 0 && next_rank < input.mesh.len() as i32 {
            return Ok(());
        }
        let next_priority = bed.get(next)?.max(priority);
        let next_cost = if next_priority > priority {
            0.0
        } else {
            cost + input.mesh.edge_length(cell, edge) * resistance.get(next)?
                / (1.0 + (input.response)(next, cell)?)
        };
        let held = priorities.get(next)?;
        if next_priority > held || (next_priority == held && next_cost >= costs.get(next)?) {
            return Ok(());
        }
        if held == f64::INFINITY {
            self.flood_fill_total += 1;
            if bed.get(next)? <= priority {
                self.flood_flat_fill_total += 1;
            }
        }
        priorities.set(next, next_priority)?;
        costs.set(next, next_cost)?;
        self.parents.set(next, cell as i32)?;
        self.ranks.set(next, i32::MAX)?;
        let [x, y] = input.mesh.position(next);
        let [ox, oy] = input.mesh.origin();
        let tie = hash_unit(input.seed, (x + ox + 0.5).floor(), (y + oy + 0.5).floor());
        queue.push(next as u32, [next_priority, next_cost, tie]);
        Ok(())
    }
}
fn seed_outlets(
    input: &Conditioning<'_>,
    mut seed: impl FnMut(usize) -> io::Result<()>,
) -> io::Result<()> {
    let boundary = |cell| -> io::Result<bool> {
        Ok(input.mesh.boundary(cell)
            && match input.incoming {
                Some(incoming) => incoming.get(cell)? <= 0.0,
                None => true,
            })
    };
    let mut count = 0;
    for cell in 0..input.mesh.len() {
        if input.water_kind.get(cell)? == 1 || (input.open_boundary && boundary(cell)?) {
            seed(cell)?;
            count += 1;
        }
    }
    if count == 0 && input.mesh.open_boundary() {
        for cell in 0..input.mesh.len() {
            if boundary(cell)? {
                seed(cell)?;
            }
        }
    }
    Ok(())
}
