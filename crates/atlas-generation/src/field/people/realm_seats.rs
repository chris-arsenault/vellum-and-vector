// Arconis: docs/architecture/subsystems.arconis#item=pp_realms — spreads realm allegiance outward from seats.
use super::{
    identity_era::{apart, place},
    identity_reads::leading_of,
    places::{Place, Places},
    realm_era::Era,
    traditions::{Founding, Kind, Tradition},
};
use crate::{
    execution::{CommandContext, ExecutionResult},
    field::Field,
    human::{
        identity::{self, Tradition as Held},
        operations::{self, Rename},
    },
};
use std::io;

pub fn active(era: &Era) -> Vec<Tradition> {
    era.memory
        .borrow()
        .traditions
        .known
        .iter()
        .filter(|t| t.kind == Kind::Allegiance && t.ended.is_none())
        .cloned()
        .collect()
}
pub fn living(places: &Places) -> Vec<Place> {
    let mut towns: Vec<_> = places
        .known
        .iter()
        .filter(|p| p.abandoned.is_none() && p.absorbed_by.is_none())
        .cloned()
        .collect();
    // hpc-exempt: named places ordered by settlement size, not cell storage.
    towns.sort_by(|a, b| {
        b.town_people
            .total_cmp(&a.town_people)
            .then_with(|| a.id.cmp(&b.id))
    });
    towns
}
pub fn seated(era: &Era, place: &str) -> bool {
    active(era)
        .iter()
        .any(|realm| realm.seat.as_deref() == Some(place))
}
pub fn found(field: &Field, era: &Era, seat: &Place, parent: Option<i32>) -> io::Result<()> {
    let (tongue, _) = identity::leading(&field.people.column(seat.anchor)?, Held::Tongue);
    let mut memory = era.memory.borrow_mut();
    let code = memory.found(Founding {
        kind: Kind::Allegiance,
        key: format!("seat:{}:{}", seat.id, era.era),
        origin: place(field, seat.anchor),
        era: era.era.clone(),
        parent,
        tongue: (tongue != 0).then_some(tongue),
    })?;
    memory.traditions.known[code as usize - 1].seat = Some(seat.id.clone());
    Ok(())
}
pub fn first(field: &Field, era: &Era, towns: &[Place]) -> io::Result<()> {
    let mut chosen: Vec<&Place> = Vec::new();
    for town in towns {
        if chosen.len() >= era.realms {
            break;
        }
        if chosen
            .iter()
            .all(|other| apart(field, town.anchor, other.anchor) >= era.reach / 2.0)
        {
            chosen.push(town);
        }
    }
    for seat in chosen {
        found(field, era, seat, None)?;
    }
    Ok(())
}
pub struct Seat {
    pub code: i32,
    pub anchor: usize,
    pub strength: f64,
}
pub fn seats(era: &Era) -> Vec<Seat> {
    let places = era.places.borrow();
    let least = places.least.max(1.0);
    active(era)
        .iter()
        .filter_map(|realm| {
            let seat = places
                .known
                .iter()
                .find(|p| Some(&p.id) == realm.seat.as_ref())?;
            Some(Seat {
                code: realm.code,
                anchor: seat.anchor,
                strength: era.capacity * (seat.town_people / least).sqrt(),
            })
        })
        .collect()
}
pub fn reseat(
    context: &mut CommandContext<'_, Field>,
    era: &Era,
    realm: &Tradition,
    owner: &operations::Operations<Field>,
) -> ExecutionResult<()> {
    let places = era.places.borrow();
    let seat = places
        .known
        .iter()
        .find(|p| Some(&p.id) == realm.seat.as_ref());
    if seat.is_some_and(|p| p.abandoned.is_none() && p.absorbed_by.is_none()) {
        return Ok(());
    }
    let absorbing = seat
        .and_then(|s| s.absorbed_by.as_ref())
        .and_then(|id| places.known.iter().find(|p| &p.id == id));
    let active = active(era);
    let joined = absorbing.and_then(|p| active.iter().find(|r| r.seat.as_ref() == Some(&p.id)));
    let allegiance = leading_of(context.state(), Held::Allegiance)?;
    let free = living(&places)
        .into_iter()
        .find(|p| allegiance.code[p.anchor] == realm.code && !seated(era, &p.id));
    let heir = absorbing.or(free.as_ref());
    let mut memory = era.memory.borrow_mut();
    let current = &mut memory.traditions.known[realm.code as usize - 1];
    if let Some(heir) = heir.filter(|_| joined.is_none()) {
        current.seat = Some(heir.id.clone());
        return Ok(());
    }
    let parent = active.iter().find(|other| Some(other.code) == realm.parent);
    current.seat = None;
    current.ended = Some(era.era.clone());
    let to = joined.or(parent).map_or(0, |r| r.code);
    let field = context.state();
    let becomes = field.coverage.borrow_mut().scratch(field.mesh.len(), to);
    context.run(
        &owner.rename,
        &Rename {
            tradition: Held::Allegiance,
            from: realm.code,
            to: becomes.read_only(),
        },
    )
}
