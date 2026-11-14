use super::{
    carry::{carried_places, CarryState},
    catalogue::Catalogue,
    contract::{Finder, OnCell, Origin, Places},
    fall_size,
    kinds::Kind,
    origins::{spaced_among, Claims},
    reads,
    river_courses::{rivers_of, RiverState},
    sites,
    values::{Found, HostLink},
    water_reads::flow_target,
};
use crate::{
    field::{shared::Scalar, significance::measure},
    hpc::{BitSet, Direction, MultiKeyHeap},
    lattice::Membership,
    noise::hash_unit,
    rock::ground::queries::SurfaceResponse,
};
use std::{io, rc::Rc};

const FALLS_APART: f64 = 3.0;
const GREAT_HEIGHT: f64 = 0.000025;
const LEDGE_CONTRAST: f64 = 150.0;
const FAULTED: f64 = 0.35;
const HANGING_SHARE: f64 = 4.0;
const PORTAGE_SPANS: f64 = 2.0;
const PORTAGE_CHANCE: f64 = 0.5;
type Reason<S> = (&'static str, &'static str, Vec<Kind>, Finder<S>);

pub fn steps_of(state: &impl RiverState) -> io::Result<Rc<Vec<usize>>> {
    state.held().get("fall:steps", || {
        let field = state.field()?;
        let mut seen = BitSet::new(field.mesh.len());
        let mut ranked = MultiKeyHeap::new([Direction::Descending], Direction::Ascending);
        for river in rivers_of(state)?.iter() {
            for &cell in &river.cells {
                if field.mesh.membership(cell) == Membership::Content
                    && !seen.has(cell)
                    && field.with_landscape(|land| land.is_river_step(cell))?
                {
                    seen.add(cell);
                    ranked.push(
                        cell as u32,
                        [field.with_landscape(|land| land.river_drop(cell))?],
                    );
                }
            }
        }
        let mut steps = Vec::new();
        while let Some((cell, _)) = ranked.pop() {
            steps.push(cell as usize);
        }
        Ok(steps)
    })
}
fn among(
    state: &impl RiverState,
    claimed: &Claims,
    passes: impl Fn(usize, Option<usize>) -> io::Result<bool>,
) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    spaced_among(
        state,
        claimed,
        &steps_of(state)?,
        field.scale.cells(FALLS_APART),
        |cell| passes(cell, flow_target(field, cell)?),
    )
}
pub fn carried<S: CarryState<Schedule>, Schedule>(
    state: &S,
    catalogue: &Catalogue<S, Schedule>,
) -> io::Result<Vec<Found>> {
    let mut found = Vec::new();
    if state.regional() {
        for item in carried_places(state, catalogue)?
            .iter()
            .filter(|item| item.kind == Kind::Waterfall)
        {
            if let Some(anchor) = state.hosted_cell(&item.carried.feature)? {
                found.push(Found {
                    anchor,
                    cells: None,
                    hosted_by: None,
                });
            }
        }
    }
    Ok(found)
}
fn great(state: &impl RiverState, claimed: &Claims) -> io::Result<Vec<Found>> {
    let bar = measure(&state.field()?.scale, GREAT_HEIGHT, 1, 0.5)?;
    among(state, claimed, |cell, _| {
        Ok(fall_size::at_cell(state, cell)?.height >= bar)
    })
}
fn ledge(state: &impl RiverState, claimed: &Claims) -> io::Result<Vec<Found>> {
    among(state, claimed, |cell, target| {
        let Some(target) = target else {
            return Ok(false);
        };
        let field = state.field()?;
        Ok(reads::rock(field, cell, SurfaceResponse::Resistance)?
            - reads::rock(field, target, SurfaceResponse::Resistance)?
            >= LEDGE_CONTRAST)
    })
}
fn fault(state: &impl RiverState, claimed: &Claims) -> io::Result<Vec<Found>> {
    let fracture = state.field()?.shared.scalar(Scalar::FractureConductance);
    among(state, claimed, |cell, _| {
        Ok(fracture.get(cell)? / 1000.0 >= FAULTED)
    })
}
fn hanging(state: &impl RiverState, claimed: &Claims) -> io::Result<Vec<Found>> {
    among(state, claimed, |cell, target| {
        let Some(target) = target else {
            return Ok(false);
        };
        Ok(reads::discharge(state.field()?, target)?
            >= HANGING_SHARE * reads::discharge(state.field()?, cell)?)
    })
}
fn shore(state: &impl RiverState, claimed: &Claims) -> io::Result<Vec<Found>> {
    let kind = state.field()?.water().column.kind;
    among(state, claimed, |_, target| {
        target
            .map(|target| Ok(matches!(kind.get(target)?, 1 | 2)))
            .unwrap_or(Ok(false))
    })
}
fn portage<S: RiverState>(
    state: &S,
    claimed: &Claims,
    settlements: &Places<S>,
) -> io::Result<Vec<Found>> {
    let field = state.field()?;
    let mut steps = BitSet::new(field.mesh.len());
    let mut taken = BitSet::new(field.mesh.len());
    for &cell in steps_of(state)?.iter() {
        steps.add(cell);
    }
    let mut found = Vec::new();
    for town in settlements(state)? {
        if hash_unit(0x7041, town.anchor as f64, 0.0) >= PORTAGE_CHANCE {
            continue;
        }
        for cell in sites::within(&field.mesh, town.anchor, field.scale.cells(PORTAGE_SPANS)) {
            if steps.has(cell) && !claimed.contains(cell) {
                if taken.add(cell) {
                    found.push(Found {
                        anchor: cell,
                        cells: None,
                        hosted_by: None,
                    });
                }
                break;
            }
        }
    }
    Ok(found)
}
/// The caller binds captured places and current settlement places, before their publication.
pub fn origins<S: RiverState + 'static>(
    carried: Finder<S>,
    settlements: Places<S>,
    link: OnCell<S, Option<HostLink>>,
) -> Vec<Origin<S>> {
    let reasons: Vec<Reason<S>> = vec![
        (
            "carried",
            "A fall the coarser map named, at its place on its river.",
            vec![],
            carried,
        ),
        (
            "great",
            "A drop so tall it needs no other reason.",
            vec![],
            Rc::new(great),
        ),
        (
            "ledge",
            "Hard rock over softer, which wore back.",
            vec![],
            Rc::new(ledge),
        ),
        (
            "fault",
            "A river crossing ground that has moved.",
            vec![],
            Rc::new(fault),
        ),
        (
            "hanging",
            "A tributary left above the greater river's deeper valley.",
            vec![],
            Rc::new(hanging),
        ),
        (
            "shore",
            "A river going over a cliff into standing water.",
            vec![],
            Rc::new(shore),
        ),
        (
            "portage",
            "A step boats must be carried round, named by the town that carries them.",
            vec![Kind::Settlement],
            Rc::new(move |state, claimed| portage(state, claimed, &settlements)),
        ),
    ];
    reasons
        .into_iter()
        .map(|(id, statement, reads, finds)| {
            let link = link.clone();
            Origin {
                id: id.into(),
                statement: statement.into(),
                reads,
                finds: Rc::new(move |state, claimed| {
                    let mut found = finds(state, claimed)?;
                    for place in &mut found {
                        place.hosted_by = link(state, place.anchor)?;
                    }
                    Ok(found)
                }),
            }
        })
        .collect()
}
