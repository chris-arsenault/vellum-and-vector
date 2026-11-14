//! Detached water records for explicit saves and captured regional inputs.
use super::{
    captured,
    reaches::{self, Reach, ReachStore},
};
use crate::lattice::TriangularLattice;
use atlas_map::Position;

fn position(mesh: &TriangularLattice, cell: usize) -> Position {
    let [x, y] = mesh.position(cell);
    let [ox, oy] = mesh.origin();
    Position::xy(x + ox, y + oy)
}
impl ReachStore {
    pub fn capture(&self, mesh: &TriangularLattice) -> captured::RetainedNetwork {
        captured::RetainedNetwork {
            next: self.next(),
            entries: self
                .entries
                .iter()
                .map(|entry| captured::BoundaryEntry {
                    position: position(mesh, entry.cell),
                    monthly: entry.monthly,
                    catchment: entry.catchment,
                })
                .collect(),
            reaches: self
                .reaches()
                .map(|reach| self.capture_reach(mesh, reach))
                .collect(),
        }
    }
    fn capture_reach(&self, mesh: &TriangularLattice, reach: &Reach) -> captured::RetainedRiver {
        let next = reach
            .downstream
            .and_then(|id| self.get(id))
            .and_then(|reach| reach.cells.first())
            .copied();
        let junction = match (reach.cells.last(), next) {
            (Some(&last), Some(next))
                if (0..3).any(|edge| mesh.neighbor(last, edge) == Some(next)) =>
            {
                Some(position(mesh, next))
            }
            _ => None,
        };
        captured::RetainedRiver {
            id: reach.id,
            course: reach
                .cells
                .iter()
                .map(|&cell| position(mesh, cell))
                .collect(),
            junction,
            downstream: reach.downstream,
            order: reach.order,
            flow: reach.flow,
            least: reach.least,
            flood: reach.flood,
            months: reach.months,
            dry: reach.dry,
            drawn: reach.drawn,
            dried_in: reach.dried_in,
            former: reach
                .former
                .iter()
                .map(|former| captured::FormerCourse {
                    course: former
                        .cells
                        .iter()
                        .map(|&cell| position(mesh, cell))
                        .collect(),
                    left_in: former.left_in,
                })
                .collect(),
            monthly: reach.monthly.clone(),
            catchment: reach.catchment.clone(),
            bed: reach.bed.clone(),
            width: reach.width.clone(),
            depth: reach.depth.clone(),
            leakage: reach.leakage.clone(),
            river: reach.river.clone(),
            record: reach.record.clone(),
            name: reach.name.clone(),
        }
    }
    /// Restore the map's own network; raster classifications cannot create or rename a river.
    pub fn restore(
        &mut self,
        saved: &captured::RetainedNetwork,
        mesh: &TriangularLattice,
    ) -> Result<(), String> {
        let [ox, oy] = mesh.origin();
        let cell = |point: Position| {
            let [x, y, _] = point.coordinates();
            mesh.cell_at(x - ox, y - oy)
                .ok_or_else(|| "Retained river has no cell on this map".to_string())
        };
        if saved.next == 0 {
            return Err("Retained river next identity must be positive".into());
        }
        let mut records = vec![None; saved.next];
        for source in &saved.reaches {
            if source.id == 0 || source.id >= saved.next || records[source.id].is_some() {
                return Err("Retained river identity is invalid or repeated".into());
            }
            let cells = source
                .course
                .iter()
                .map(|&p| cell(p))
                .collect::<Result<Vec<_>, _>>()?;
            let mut reach = Reach::new(source.id, cells);
            reach.downstream = source.downstream;
            reach.order = source.order;
            reach.flow = source.flow;
            reach.least = source.least;
            reach.flood = source.flood;
            reach.months = source.months;
            reach.dry = source.dry;
            reach.drawn = source.drawn;
            reach.dried_in = source.dried_in;
            reach.former = source
                .former
                .iter()
                .map(|former| {
                    Ok(reaches::FormerCourse {
                        cells: former
                            .course
                            .iter()
                            .map(|&p| cell(p))
                            .collect::<Result<_, String>>()?,
                        left_in: former.left_in,
                    })
                })
                .collect::<Result<_, String>>()?;
            reach.monthly = source.monthly.clone();
            reach.catchment = source.catchment.clone();
            reach.bed = source.bed.clone();
            reach.width = source.width.clone();
            reach.depth = source.depth.clone();
            reach.leakage = source.leakage.clone();
            reach.river = source.river.clone();
            reach.record = source.record.clone();
            reach.name = source.name.clone();
            records[source.id] = Some(reach);
        }
        let entries = saved
            .entries
            .iter()
            .map(|entry| {
                Ok(reaches::BoundaryEntry {
                    cell: cell(entry.position)?,
                    monthly: entry.monthly,
                    catchment: entry.catchment,
                })
            })
            .collect::<Result<_, String>>()?;
        *self.records_mut() = records;
        self.entries = entries;
        Ok(())
    }
}
