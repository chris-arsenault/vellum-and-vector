//! Cartographic river reads use retained identities, never reconstruct courses from drainage.
use super::{
    river_join::{self, JoinedRiver, ReachOnMap},
    state::State,
};
use crate::{
    field::Field,
    hpc::{BitSet, Direction, MultiKeyHeap},
    storage::Band,
    water::{
        captured::DrainageReach,
        network::{RiverReader, RiverSample, RiverTerrain},
        reaches::Reach,
        visibility::unwrap,
    },
};
use atlas_map::Position;
use std::{io, rc::Rc};

pub struct ReachMembers {
    pub start: usize,
    pub members: Vec<usize>,
    pub kept: Reach,
    pub reach: DrainageReach,
}
fn record(
    field: &Field,
    reader: &RiverReader<'_>,
    kept: &Reach,
    members: &[usize],
    downstream: Option<usize>,
) -> io::Result<DrainageReach> {
    let water = field.water();
    let start = members[0];
    let mouth = *members.last().unwrap();
    let [ox, oy] = field.mesh.origin();
    let mut coordinates = members
        .iter()
        .map(|&cell| {
            let [x, y] = field.mesh.position(cell);
            Position::xy((x + ox + 0.5).floor(), (y + oy + 0.5).floor())
        })
        .collect::<Vec<_>>();
    unwrap(&mut coordinates, field.mesh.periodic_width());
    Ok(DrainageReach {
        downstream,
        water_body: if water.column.kind.get(mouth)? != 0 {
            usize::try_from(water.column.body.get(mouth)?).ok()
        } else {
            None
        },
        order: kept.order(),
        basin: water.routing.basins.get(start)?,
        coordinates,
        discharges: members
            .iter()
            .map(|&cell| Ok(reader.water_at(cell, false, water.flow.mean.get(cell)?)))
            .collect::<io::Result<_>>()?,
        catchment_areas: members
            .iter()
            .map(|&cell| {
                Ok(reader.sample(
                    cell,
                    RiverSample::Catchment,
                    water.flow.catchment.get(cell)?,
                ))
            })
            .collect::<io::Result<_>>()?,
        feature_ids: Vec::new(),
    })
}
pub fn kept_reaches(field: &Field) -> io::Result<Vec<ReachMembers>> {
    let owner = field.water.borrow();
    let store = owner.rivers();
    let reader = owner.river_reader();
    let water = owner.read_only();
    let terrain = RiverTerrain {
        mesh: &field.mesh,
        water_kind: &water.column.kind,
        targets: &water.routing.targets,
    };
    let wanted: Vec<_> = store.reaches().filter(|reach| !reach.dry()).collect();
    let mut indices = vec![None; store.next()];
    for (at, reach) in wanted.iter().enumerate() {
        indices[reach.id()] = Some(at);
    }
    wanted
        .into_iter()
        .map(|kept| {
            let next = reader.successor(*kept.cells().last().unwrap(), Some(kept), &terrain)?;
            let members: Vec<_> = kept.cells().iter().copied().chain(next).collect();
            let downstream = kept
                .downstream()
                .filter(|&id| {
                    next.is_some()
                        && next
                            == store
                                .get(id)
                                .and_then(|reach| reach.cells().first().copied())
                })
                .and_then(|id| indices[id]);
            Ok(ReachMembers {
                start: kept.cells()[0],
                reach: record(field, &reader, kept, &members, downstream)?,
                members,
                kept: kept.clone(),
            })
        })
        .collect()
}
pub fn basin_discharges(field: &Field) -> io::Result<Band<f64>> {
    let mut discharge: Band<f64> = field
        .coverage
        .borrow_mut()
        .scratch(field.mesh.len() + 1, 0.0);
    let water = field.water();
    for cell in 0..field.mesh.len() {
        let basin = water.routing.basins.get(cell)? as usize;
        discharge.set(basin, discharge.get(basin)?.max(water.flow.mean.get(cell)?))?;
    }
    Ok(discharge)
}
pub fn drawn(world: bool, records: &[ReachMembers]) -> Vec<JoinedRiver> {
    river_join::join(
        &records
            .iter()
            .map(|record| ReachOnMap {
                downstream: record.reach.downstream,
                in_frame: world || !record.members.is_empty(),
                course: if record.kept.drawn() {
                    record.kept.river()
                } else {
                    None
                },
            })
            .collect::<Vec<_>>(),
    )
}
pub struct River {
    pub id: String,
    pub cells: Vec<usize>,
}
pub trait RiverState: State {
    fn world_geography(&self) -> bool;
}
pub fn rivers_of(state: &impl RiverState) -> io::Result<Rc<Vec<River>>> {
    state.held().get("rivers:mapped", || {
        let Some(field) = state.physical() else {
            return Ok(Vec::new());
        };
        let records = kept_reaches(field)?;
        let water = field.water.borrow();
        let reader = water.river_reader();
        let kind = water.read_only().column.kind;
        let mut rivers = Vec::new();
        let mut ranked = MultiKeyHeap::new([Direction::Descending], Direction::Ascending);
        for river in drawn(state.world_geography(), &records) {
            let mut cells = Vec::new();
            for part in river.parts {
                for (n, index) in part.into_iter().enumerate() {
                    for &cell in records[index].members.iter().skip(usize::from(n > 0)) {
                        if reader.order_at(cell, kind.get(cell)?) > 0 {
                            cells.push(cell);
                        }
                    }
                }
            }
            if !cells.is_empty() {
                ranked.push(rivers.len() as u32, [cells.len() as f64]);
                rivers.push(Some(River {
                    id: river.river_id,
                    cells,
                }));
            }
        }
        let mut result = Vec::with_capacity(rivers.len());
        while let Some((at, _)) = ranked.pop() {
            result.push(rivers[at as usize].take().unwrap());
        }
        Ok(result)
    })
}
pub fn mapped_cells(state: &impl RiverState) -> io::Result<Rc<BitSet>> {
    state.held().get("rivers:cells", || {
        let mut cells = BitSet::new(state.physical().map_or(0, |f| f.mesh.len()));
        for river in rivers_of(state)?.iter() {
            for &cell in &river.cells {
                cells.add(cell);
            }
        }
        Ok(cells)
    })
}
pub fn river_id_at(state: &impl RiverState, cell: usize) -> io::Result<Option<String>> {
    let identities = state.held().get("rivers:identities", || {
        let mut identities = vec![None; state.physical().map_or(0, |f| f.mesh.len())];
        for (at, river) in rivers_of(state)?.iter().enumerate() {
            for &cell in &river.cells {
                identities[cell].get_or_insert(at);
            }
        }
        Ok(identities)
    })?;
    identities
        .get(cell)
        .copied()
        .flatten()
        .map(|at| rivers_of(state).map(|rivers| rivers[at].id.clone()))
        .transpose()
}
