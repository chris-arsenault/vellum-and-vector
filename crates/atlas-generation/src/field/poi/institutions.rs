//! Institutions and cultural origins: where a people's tongue and faith are kept and taught,
//! and the hearths they came from. The old society cycle gave every community of more than
//! five thousand a meeting house that carried language and faith and strengthened its realm,
//! and marked where each culture began.
use super::{
    community_records::{self, CommunityState},
    contract::*,
    kinds::{Group, Kind},
    map_records::Record,
    places, settlement_reads as settled,
    values::*,
};
use crate::{
    features::Feature, field::people::traditions::Kind as TraditionKind,
    human::identity::Tradition,
};
use atlas_map::{Geometry, Position};
use std::{io, rc::Rc};

/// How many times the least town a town must hold before it keeps an institution.
const INSTITUTION_TOWN: f64 = 8.0;
/// How much a full meeting house adds to its realm's strength: the old society cycle's
/// institutional influence.
const INFLUENCE: f64 = 0.1;

fn point(state: &impl CommunityState, cell: usize) -> io::Result<Geometry> {
    let field = state.field()?;
    let [x, y] = field.mesh.position(cell);
    let [ox, oy] = field.mesh.origin();
    Ok(Geometry::Point {
        coordinates: Position::xy(x + ox, y + oy),
    })
}
/// The towns large enough to keep a meeting house, temple or academy.
fn institutions(state: &impl CommunityState) -> io::Result<Vec<Place>> {
    let known = state.known_places();
    let least = known.least.max(1.0);
    Ok(known
        .known
        .iter()
        .filter(|p| p.abandoned.is_none() && p.absorbed_by.is_none())
        .filter(|p| p.town_people >= INSTITUTION_TOWN * least)
        .map(|p| {
            let mut place = Place::at(Kind::Institution, p.anchor, vec![p.anchor]);
            place.id = format!("institution:{}", p.id);
            place
        })
        .collect())
}
/// Where each living tongue and faith began.
fn origins(state: &impl CommunityState) -> io::Result<Vec<Place>> {
    let field = state.field()?;
    let [ox, oy] = field.mesh.origin();
    let mut found = Vec::new();
    for tradition in state.traditions().known.iter() {
        if tradition.ended.is_some()
            || !matches!(tradition.kind, TraditionKind::Tongue | TraditionKind::Faith)
        {
            continue;
        }
        let Some(cell) = field
            .mesh
            .cell_at(tradition.origin.x - ox, tradition.origin.y - oy)
        else {
            continue;
        };
        let mut place = Place::at(Kind::CulturalOrigin, cell, vec![cell]);
        place.id = format!("origin:{}", tradition.code);
        place.origin = Some(tradition.code.to_string());
        found.push(place);
    }
    Ok(found)
}
fn size(state: &impl CommunityState, place: &Place) -> f64 {
    let known = state.known_places();
    let least = known.least.max(1.0);
    known
        .known
        .iter()
        .find(|p| p.anchor == place.anchor && p.abandoned.is_none())
        .map_or(0.0, |p| (p.town_people / (INSTITUTION_TOWN * least)).sqrt().min(1.0))
}
fn record<S: CommunityState>(state: &S, place: &Place, kind: &str, name: &str, layer: &str) -> io::Result<Option<Feature>> {
    let mut attributes = crate::features::records::Attributes::new();
    let faith = settled::leading(state, place.anchor, Tradition::Faith)?;
    let tongue = settled::leading(state, place.anchor, Tradition::Tongue)?;
    let traditions = state.traditions();
    for (key, code) in [("faithId", faith), ("languageId", tongue)] {
        if let Some(t) = traditions.get(code) {
            attributes.insert(key.into(), t.entity.into());
        }
    }
    drop(traditions);
    Ok(Some(community_records::local_record(
        state,
        Record { key: &place.id, name, kind, layer, geometry: point(state, place.anchor)?, attributes },
    )?))
}
fn people<S: CommunityState + 'static>(origin: bool) -> People<S> {
    People {
        statement: Must::Value(if origin {
            "A culture's hearth is sacred to the people who still hold its tongue or faith."
        } else {
            "A meeting house keeps its people's faith and draws scholars and pilgrims."
        }.into()),
        offers: Slot::Value(Rc::new(move |state, place| {
            if origin {
                let code: i32 = place.origin.as_deref().and_then(|c| c.parse().ok()).unwrap_or(0);
                let kind = state.traditions().get(code).map(|t| t.kind);
                let tradition = if kind == Some(TraditionKind::Faith) { Tradition::Faith } else { Tradition::Tongue };
                return Ok([(Benefit::Sanctity, 0.5)].into_iter().collect::<Benefits>().serving(Benefit::Sanctity, tradition, code));
            }
            let strength = size(state, place);
            let faith = settled::leading(state, place.anchor, Tradition::Faith)?;
            let tongue = settled::leading(state, place.anchor, Tradition::Tongue)?;
            let realm = settled::leading(state, place.anchor, Tradition::Allegiance)?;
            let mut offers: Benefits =
                [(Benefit::Sanctity, strength), (Benefit::Trade, strength / 3.0)]
                    .into_iter()
                    .collect();
            // A house in a town no realm holds upholds no rule.
            if realm != 0 {
                offers.insert(Benefit::Rule, INFLUENCE * strength);
            }
            Ok(offers
                .serving(Benefit::Sanctity, Tradition::Faith, faith)
                .serving(Benefit::Trade, Tradition::Tongue, tongue)
                .serving(Benefit::Rule, Tradition::Allegiance, realm))
        })),
        threatens: Slot::NotApplicable("A house of learning or a hearth endangers no one."),
    }
}
fn roles<S: CommunityState + 'static>(kind: Kind, origin: bool) -> Roles<S> {
    Roles {
        true_size: super::true_sizes::sited(&super::true_sizes::SHRINE),
        variety: Slot::Unwritten,
        appearance: Slot::Unwritten,
        account: super::true_sizes::account(kind),
        fields: Fields {
            statement: Must::Value("It changes no ground, water, climate, cover or magic.".into()),
            terrain: Slot::NotApplicable("It stands on the town's ground."),
            water: Slot::NotApplicable("It takes no water."),
            climate: Slot::NotApplicable("It warms nothing."),
            cover: Slot::NotApplicable("It clears nothing beyond its town."),
            magic: Slot::NotApplicable("It keeps no magic."),
        },
        movement: Movement {
            on_foot: Some(TrailRole::Destination),
            statement: Must::Value("People come to it on the town's own ways.".into()),
            roads: Slot::NotApplicable("Its town's roads serve it."),
            boats: Slot::NotApplicable("People reach it by land."),
            drainage: Slot::NotApplicable("It holds no water."),
            magic: Slot::NotApplicable("It carries no magic."),
            links: Slot::NotApplicable("It joins no cells."),
            crosses: Slot::NotApplicable("It crosses nothing."),
        },
        others: Others {
            statement: Must::Value(if origin { "A hearth stands where its culture began, with or without a town." } else { "An institution stands in a large town." }.into()),
            needs: if origin {
                Slot::NotApplicable("A hearth needs only its memory.")
            } else {
                Slot::Value(vec![Relation {
                    kind: Kind::Settlement,
                    holds: Rc::new(|_, a, b| Ok(a.anchor == b.anchor)),
                }])
            },
            excludes: Slot::NotApplicable("Nothing excludes it."),
            contains: Slot::NotApplicable("It is one place."),
            pairs_with: Slot::NotApplicable("It pairs with nothing in particular."),
        },
        people: people(origin),
        time: ThroughTime {
            statement: Must::Value("It lasts while its town or its culture does.".into()),
            fate: Slot::Value(Rc::new(|_, _| Ok(Fate::Persists))),
        },
        visibility: Visibility {
            statement: Must::Value("Its town's size, or its culture's reach, makes it notable.".into()),
            magnitude: Slot::Value(Rc::new(move |state, place| Ok(if origin { 0.6 } else { size(state, place) }))),
            local_conditions: Slot::NotApplicable("It stands out by what it keeps, not its ground."),
            isolation: Slot::NotApplicable("Its distance from others does not matter."),
            cultural: Slot::Value(Rc::new(move |state, place| Ok(if origin { 0.8 } else { size(state, place) }))),
            importance: Must::Value(Rc::new(move |state: &S, place| Ok(if origin { 0.6 } else { size(state, place) }))),
        },
        naming: Naming {
            statement: Must::Value("Its people name it in their own tongue.".into()),
            named_by: Slot::Value(Rc::new(places::naming_culture_near)),
            takes_name_from: Slot::NotApplicable("It takes the name of what it keeps."),
            lends_name_to: Slot::NotApplicable("It lends no name."),
            term: Slot::Unwritten,
        },
    }
}
fn entry<S: CommunityState + 'static, Schedule>(origin: bool) -> Entry<S, Schedule> {
    let kind = if origin { Kind::CulturalOrigin } else { Kind::Institution };
    let (record_kind, name, layer) = if origin {
        ("culturalOrigin", "Hearth of a culture", "cultures")
    } else {
        ("institution", "Meeting house", "institutions")
    };
    let find: Places<S> = if origin { Rc::new(|s: &S| origins(s)) } else { Rc::new(|s: &S| institutions(s)) };
    let finding = find.clone();
    Entry {
        id: kind,
        group: Group::Settlements,
        name: name.into(),
        recognition: Recognition {
            distinct: Must::Value(if origin { "Where a living tongue or faith began." } else { "A house a large town keeps for its faith and learning." }.into()),
            is_a: Must::Value(Rc::new(move |state, cell| places::holds_record(state, kind, cell, || finding(state)))),
            landform: Slot::NotApplicable("It is no landform."),
        },
        existence: Existence {
            origins: Slot::Unwritten,
            statement: Must::Value(if origin { "Each living tongue and faith has one hearth, where it was founded." } else { "Every town of eight times the least town keeps one." }.into()),
            way: Must::Value(ExistenceWay::Emerges),
            requires: Slot::NotApplicable("Its people decide where it stands."),
            suitability: Slot::NotApplicable("Its people decide where it stands."),
            places: Must::Value(find),
        },
        publication: Publication {
            delivery: Delivery::Landforms,
            statement: Must::Value("Publish it at its cell.".into()),
            moment: Must::Value(Moment::Society),
            record: Must::Value(Rc::new(move |state: &S, place: &Place| record(state, place, record_kind, name, layer))),
        },
        across_maps: AcrossMaps {
            statement: Must::Value("A finer map finds it again from its own people.".into()),
            stands_on: Slot::Unwritten,
            carry: Slot::NotApplicable("It is found again, not carried."),
            realize: Slot::NotApplicable("It shapes no ground."),
            counterpart: Slot::NotApplicable("It is found again from the people."),
            unrealized: Slot::NotApplicable("It is found again from the people."),
            settle: Slot::NotApplicable("It does not move with water."),
            schedule: Slot::NotApplicable("It adds no refinement step."),
        },
        event: None,
        roles: roles(kind, origin),
    }
}
pub fn institution<S: CommunityState + 'static, Schedule>() -> Entry<S, Schedule> {
    entry(false)
}
pub fn cultural_origin<S: CommunityState + 'static, Schedule>() -> Entry<S, Schedule> {
    entry(true)
}
