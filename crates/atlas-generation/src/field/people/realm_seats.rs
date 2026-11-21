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
pub fn seats(field: &Field, era: &Era) -> io::Result<Vec<Seat>> {
    let places = era.places.borrow();
    let least = places.least.max(1.0);
    let towns = living(&places);
    let allegiance = leading_of(field, Held::Allegiance)?;
    let mut found = Vec::new();
    for realm in active(era) {
        let Some(seat) = places
            .known
            .iter()
            .find(|p| Some(&p.id) == realm.seat.as_ref())
        else {
            continue;
        };
        let upheld = upheld(field, &towns, &allegiance.code, realm.code, seat.anchor)?;
        found.push(Seat {
            code: realm.code,
            anchor: seat.anchor,
            // A realm reaches as far as its seat's crowd, its own health and the houses its
            // towns keep for it carry it.
            strength: era.capacity
                * (seat.town_people / least).sqrt()
                * realm.health
                * (1.0 + upheld),
        });
    }
    Ok(found)
}
/// The rule a realm's own towns give it beyond its seat: the meeting houses and other places
/// that serve the realm, read as offers like any people's benefit. The seat's own crowd is
/// already the strength's base.
fn upheld(
    field: &Field,
    towns: &[Place],
    allegiance: &[i32],
    realm: i32,
    seat: usize,
) -> io::Result<f64> {
    let Some(offers) = field.place_offers() else {
        return Ok(0.0);
    };
    let mut given = 0.0;
    for town in towns {
        if town.anchor != seat && allegiance[town.anchor] == realm {
            given += offers.benefit(crate::field::poi::values::Benefit::Rule, town.anchor)?;
        }
    }
    Ok(given)
}
/// How much larger than its seat a town of the realm must grow to draw the seat to itself.
const SEAT_INERTIA: f64 = 1.5;
/// Moves a realm's seat to a town of its own allegiance that has grown well past it.
pub fn follow_the_crowd(field: &Field, era: &Era, realm: &Tradition) -> io::Result<()> {
    let places = era.places.borrow();
    let Some(seat) = places
        .known
        .iter()
        .find(|p| Some(&p.id) == realm.seat.as_ref())
    else {
        return Ok(());
    };
    let allegiance = leading_of(field, Held::Allegiance)?;
    let grown = living(&places).into_iter().find(|town| {
        allegiance.code[town.anchor] == realm.code
            && town.id != seat.id
            && !seated(era, &town.id)
            && town.town_people > SEAT_INERTIA * seat.town_people
    });
    if let Some(town) = grown {
        if std::env::var_os("ATLAS_TRACE_PEOPLE").is_some() {
            eprintln!(
                "{}",
                serde_json::json!({"event": "people.seat-moved", "details": {
                    "realm": realm.code, "from": seat.id, "to": town.id,
                    "fromPeople": seat.town_people.round(), "toPeople": town.town_people.round()}})
            );
        }
        drop(places);
        era.memory.borrow_mut().traditions.known[realm.code as usize - 1].seat = Some(town.id);
    }
    Ok(())
}
/// How well a realm holds together, toward which its health moves over the years: the share
/// of its people its land feeds, worn by how far its towns have fallen from their peak.
pub fn holding(fed: f64, declined: f64) -> f64 {
    fed.clamp(0.0, 1.0) * (1.0 - 0.75 * declined.clamp(0.0, 1.0))
}
/// How fast a realm's health follows its holding, in years.
const HEALTH_YEARS: f64 = 80.0;
/// Moves each realm's health toward its holding: what its land feeds of its people and how
/// its towns stand.
pub fn tend(field: &Field, era: &Era, support: &crate::storage::ReadBand<f64>) -> io::Result<()> {
    let allegiance = leading_of(field, Held::Allegiance)?;
    let realms = active(era);
    let index = |code: i32| realms.iter().position(|r| r.code == code);
    let (mut people, mut fed) = (vec![0.0; realms.len()], vec![0.0; realms.len()]);
    for cell in 0..field.mesh.len() {
        let Some(at) = index(allegiance.code[cell]) else {
            continue;
        };
        let area = super::work::km2(field, cell);
        people[at] += field.people.people(cell)? * area;
        fed[at] += support.get(cell)?.max(0.0) * area;
    }
    let (mut now, mut peak) = (vec![0.0; realms.len()], vec![0.0; realms.len()]);
    for place in era
        .places
        .borrow()
        .known
        .iter()
        .filter(|p| p.absorbed_by.is_none())
    {
        if let Some(at) = index(allegiance.code[place.anchor]) {
            now[at] += place.town_people;
            peak[at] += place.peak.max(place.town_people);
        }
    }
    let settling = 1.0 - (-era.years / HEALTH_YEARS).exp();
    let mut traced = Vec::new();
    let mut memory = era.memory.borrow_mut();
    for (at, realm) in realms.iter().enumerate() {
        let fed_share = if people[at] > 0.0 {
            fed[at] / people[at]
        } else {
            1.0
        };
        let declined = if peak[at] > 0.0 {
            1.0 - now[at] / peak[at]
        } else {
            0.0
        };
        let record = &mut memory.traditions.known[realm.code as usize - 1];
        record.health += (holding(fed_share, declined) - record.health) * settling;
        traced.push(serde_json::json!({
            "realm": realm.code, "people": people[at].round(),
            "fed": (fed_share * 100.0).round() / 100.0,
            "declined": (declined * 100.0).round() / 100.0,
            "health": (record.health * 100.0).round() / 100.0,
        }));
    }
    if std::env::var_os("ATLAS_TRACE_PEOPLE").is_some() {
        eprintln!(
            "{}",
            serde_json::json!({"event": "people.realms", "details": {"era": era.era, "realms": traced}})
        );
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::holding;

    #[test]
    fn a_realm_holds_together_as_its_land_feeds_its_people_and_its_towns_stand() {
        assert_eq!(holding(1.0, 0.0), 1.0);
        assert!(holding(0.5, 0.0) < holding(1.0, 0.0));
        assert!(holding(1.0, 0.6) < holding(1.0, 0.1));
        assert!((holding(1.0, 1.0) - 0.25).abs() < 1e-12);
        assert_eq!(holding(2.0, -1.0), 1.0);
    }
}
