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
        let taught = taught(field, &towns, &allegiance.code, realm.code)?;
        found.push(Seat {
            code: realm.code,
            anchor: seat.anchor,
            strength: strength(era.capacity, seat.town_people / least, realm.health, taught),
        });
    }
    Ok(found)
}
/// How much a full temple or academy in a realm's town adds to the realm's strength: the old
/// society cycle's institutional influence.
const INFLUENCE: f64 = 0.1;
/// A realm's strength: its seat's crowd (in least towns), its health, and the learning its
/// towns' temples and academies give its people.
pub fn strength(capacity: f64, seat_towns: f64, health: f64, taught: f64) -> f64 {
    capacity * seat_towns.max(0.0).sqrt() * health * (1.0 + INFLUENCE * taught.max(0.0))
}
/// The learning a realm's towns receive from the temples and academies that teach their
/// people, read as offers like any benefit.
fn taught(field: &Field, towns: &[Place], allegiance: &[i32], realm: i32) -> io::Result<f64> {
    let Some(offers) = field.place_offers() else {
        return Ok(0.0);
    };
    let mut given = 0.0;
    for town in towns.iter().filter(|t| allegiance[t.anchor] == realm) {
        given += offers.benefit(crate::field::poi::values::Benefit::Learning, town.anchor)?;
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
/// How fast a realm's health follows its holding, in years.
const HEALTH_YEARS: f64 = 80.0;
/// The share of the people of each realm in `realms` that their own ground feeds, counting
/// each cell's people only as far as its land supports them, as the old society cycle did:
/// a hungry province weakens its realm, and plenty elsewhere does not make up for it. A realm
/// with no people is whole.
pub fn fed_shares(
    field: &Field,
    realms: &[i32],
    leads: &[i32],
    support: &crate::storage::ReadBand<f64>,
) -> io::Result<Vec<f64>> {
    let (mut people, mut fed) = (vec![0.0; realms.len()], vec![0.0; realms.len()]);
    for (cell, &lead) in leads.iter().enumerate().take(field.mesh.len()) {
        let Some(at) = realms.iter().position(|&r| r == lead) else {
            continue;
        };
        let area = super::work::km2(field, cell);
        let here = field.people.people(cell)?;
        people[at] += here * area;
        fed[at] += here.min(support.get(cell)?.max(0.0)) * area;
    }
    Ok(people
        .iter()
        .zip(&fed)
        .map(|(&people, &fed)| if people > 0.0 { fed / people } else { 1.0 })
        .collect())
}
/// A realm's health after `years` relaxing toward the share of its people it feeds.
pub fn relaxed(health: f64, fed: f64, years: f64) -> f64 {
    let settling = 1.0 - (-years.max(0.0) / HEALTH_YEARS).exp();
    health + (fed.clamp(0.0, 1.0) - health) * settling
}
/// Moves each realm's health toward the share of its people its land feeds.
pub fn tend(field: &Field, era: &Era, support: &crate::storage::ReadBand<f64>) -> io::Result<()> {
    let allegiance = leading_of(field, Held::Allegiance)?;
    let realms = active(era);
    let codes: Vec<i32> = realms.iter().map(|r| r.code).collect();
    let fed = fed_shares(field, &codes, &allegiance.code, support)?;
    let mut traced = Vec::new();
    let mut memory = era.memory.borrow_mut();
    for (realm, &fed) in realms.iter().zip(&fed) {
        let record = &mut memory.traditions.known[realm.code as usize - 1];
        record.health = relaxed(record.health, fed, era.years);
        traced.push(serde_json::json!({
            "realm": realm.code,
            "fed": (fed * 100.0).round() / 100.0,
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
    use super::{fed_shares, relaxed, strength, taught, HEALTH_YEARS};
    use crate::field::{
        people::fixture::*,
        poi::{offered::PlaceOffers, values::Benefit},
    };
    use std::rc::Rc;

    #[test]
    fn a_temple_in_a_realms_town_strengthens_that_realm_and_no_other() {
        let (mut ours, mut theirs) = (0, 0);
        let mut field = land(|seed, mesh| {
            ours = point(mesh, 300.0, 500.0);
            theirs = point(mesh, 700.0, 500.0);
            people(seed, ours, &[layer(100.0, 1, 0, 3, 0)]);
            people(seed, theirs, &[layer(100.0, 1, 0, 4, 0)]);
        });
        let offers = PlaceOffers::only(&field, Benefit::Learning, |cell| {
            if cell == ours {
                0.8
            } else {
                0.0
            }
        })
        .unwrap();
        field.place_offers = Some(Rc::new(offers));
        let towns = vec![
            place("ours", ours, vec![ours], 100.0),
            place("theirs", theirs, vec![theirs], 100.0),
        ];
        let mut leads = vec![0; field.mesh.len()];
        leads[ours] = 3;
        leads[theirs] = 4;
        let ours_taught = taught(&field, &towns, &leads, 3).unwrap();
        let theirs_taught = taught(&field, &towns, &leads, 4).unwrap();
        assert!((ours_taught - 0.8).abs() < 1e-12);
        assert_eq!(theirs_taught, 0.0);
        assert!(strength(1.0, 4.0, 1.0, ours_taught) > strength(1.0, 4.0, 1.0, theirs_taught));
        // A realm reaches with its seat's crowd and its health.
        assert_eq!(strength(1.0, 4.0, 0.5, 0.0), 1.0);
    }

    #[test]
    fn a_hungry_province_weakens_its_realm_and_plenty_elsewhere_does_not_hide_it() {
        let (mut fat, mut lean, mut other) = (0, 0, 0);
        let field = land(|seed, mesh| {
            fat = point(mesh, 200.0, 500.0);
            lean = point(mesh, 800.0, 500.0);
            other = point(mesh, 500.0, 200.0);
            people(seed, fat, &[layer(100.0, 1, 0, 7, 0)]);
            people(seed, lean, &[layer(100.0, 1, 0, 7, 0)]);
            people(seed, other, &[layer(100.0, 1, 0, 8, 0)]);
        });
        // The fat province grows four times what it eats; the lean one half.
        let support = band(&field, |cell| {
            if cell == fat {
                400.0
            } else if cell == lean {
                50.0
            } else {
                100.0
            }
        });
        let mut leads = vec![0; field.mesh.len()];
        leads[fat] = 7;
        leads[lean] = 7;
        leads[other] = 8;
        let fed = fed_shares(&field, &[7, 8, 9], &leads, &support).unwrap();
        // Realm 7 feeds all of one province and half the other: three quarters of its people.
        assert!((fed[0] - 0.75).abs() < 1e-9, "{}", fed[0]);
        assert!((fed[1] - 1.0).abs() < 1e-9);
        // A realm with no people is whole.
        assert_eq!(fed[2], 1.0);
    }
    #[test]
    fn health_follows_feeding_over_the_years_and_recovers_when_fed() {
        let starved = relaxed(1.0, 0.4, HEALTH_YEARS);
        assert!((starved - (1.0 - 0.6 * (1.0 - (-1.0f64).exp()))).abs() < 1e-12);
        assert!(relaxed(starved, 1.0, 10.0 * HEALTH_YEARS) > 0.99);
        assert_eq!(relaxed(0.7, 0.2, 0.0), 0.7);
    }
}
