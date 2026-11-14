use super::{
    places::{Place, Places},
    works::Works,
};
use crate::{field::Field, hpc::BitSet, storage::ReadBand, water::network::RiverReader};
use std::io;

pub struct Trial {
    pub cell: usize,
    pub place: String,
}
fn site(field: &Field, place: &Place, river: &RiverReader<'_>) -> io::Result<Option<usize>> {
    let water = field.water();
    let mut best = None;
    let mut flow = 0.0;
    let mut consider = |cell| -> io::Result<()> {
        let kind = water.column.kind.get(cell)?;
        if kind != 0 || river.order_at(cell, kind) == 0 {
            return Ok(());
        }
        let carried = river.water_at(cell, false, water.flow.mean.get(cell)?);
        if carried > flow {
            best = Some(cell);
            flow = carried;
        }
        Ok(())
    };
    for &cell in &place.cells {
        consider(cell)?;
        for edge in 0..3 {
            if let Some(next) = field.mesh.neighbor(cell, edge) {
                consider(next)?;
            }
        }
    }
    Ok(best)
}
pub fn trials(field: &Field, places: &Places, works: &Works) -> io::Result<Vec<Trial>> {
    let water = field.water.borrow();
    let reader = water.river_reader();
    let mut cells = BitSet::new(field.mesh.len());
    let mut wanted = Vec::new();
    for place in &places.known {
        if place.abandoned.is_some()
            || place.absorbed_by.is_some()
            || works.standing().any(|w| w.place == place.id)
        {
            continue;
        }
        let Some(cell) = site(field, place, &reader)? else {
            continue;
        };
        if cells.has(cell) || works.tried(cell) {
            continue;
        }
        cells.add(cell);
        wanted.push(Trial {
            cell,
            place: place.id.clone(),
        });
    }
    Ok(wanted)
}
fn lives(places: &Places, id: &str) -> bool {
    let mut place = places.known.iter().find(|p| p.id == id);
    while let Some(absorbed) = place.and_then(|p| p.absorbed_by.as_ref()) {
        place = places.known.iter().find(|p| &p.id == absorbed);
    }
    place.is_some_and(|p| p.abandoned.is_none())
}
pub fn fail_abandoned(places: &Places, works: &mut Works, era: &str) -> bool {
    let failed: Vec<_> = works
        .standing()
        .filter(|w| !lives(places, &w.place))
        .map(|w| w.id.clone())
        .collect();
    for id in &failed {
        works.fail(id, era);
    }
    !failed.is_empty()
}
fn impounded(field: &Field, cell: usize, before: &ReadBand<u8>) -> io::Result<Vec<usize>> {
    let kind = field.water().column.kind;
    let mut seen = BitSet::new(field.mesh.len());
    let mut queue = vec![cell];
    let mut water = Vec::new();
    while let Some(cell) = queue.pop() {
        for edge in 0..3 {
            let Some(next) = field.mesh.neighbor(cell, edge) else {
                continue;
            };
            if kind.get(next)? != 2 || before.get(next)? != 0 || seen.has(next) {
                continue;
            }
            seen.add(next);
            water.push(next);
            queue.push(next);
        }
    }
    Ok(water)
}
pub fn judge(
    field: &Field,
    works: &mut Works,
    wanted: &[Trial],
    before: &ReadBand<u8>,
    era: &str,
) -> io::Result<(bool, usize)> {
    let mut held = BitSet::new(field.mesh.len());
    let mut dry = false;
    let mut accepted = 0;
    for trial in wanted {
        let water: Vec<_> = impounded(field, trial.cell, before)?
            .into_iter()
            .filter(|&cell| !held.has(cell))
            .collect();
        if water.len() >= 2 {
            works.record(trial.cell, trial.place.clone(), era.into(), water.len());
            accepted += 1;
            for cell in water {
                held.add(cell);
            }
        } else {
            works.record_dry(trial.cell);
            dry = true;
        }
    }
    Ok((dry, accepted))
}
