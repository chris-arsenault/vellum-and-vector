use super::{
    community_records::{self, CommunityState},
    kinds::Kind,
    map_records::Record,
    values::Place,
};
use crate::{
    features::{records::Attributes, Feature},
    field::people::{
        place_land::{self, PlaceLand},
        place_peoples,
        places::Place as KnownPlace,
    },
    human::identity::{self, Tradition},
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

pub fn record_id(state: &impl CommunityState, place: &KnownPlace) -> atlas_map::Id {
    place
        .adopted
        .unwrap_or_else(|| community_records::local_id(state, &place.id))
}
fn standing(
    state: &impl CommunityState,
    place: &KnownPlace,
    least: f64,
    attributes: &mut Attributes,
) -> io::Result<()> {
    let traditions = state.traditions();
    let seat = traditions
        .known
        .iter()
        .find(|tradition| tradition.seat.as_deref() == Some(&place.id));
    let (allegiance, _) = identity::leading(
        &state.field()?.people.column(place.anchor)?,
        Tradition::Allegiance,
    );
    let realm = seat.or_else(|| traditions.get(allegiance));
    let role = if place.abandoned.is_some() {
        "settlement"
    } else if seat.is_some() {
        "capital"
    } else if place.town_people >= 4.0 * least && regional_capital(state, place, allegiance)? {
        "regionalCapital"
    } else if place.town_people >= 4.0 * least {
        "marketTown"
    } else {
        "settlement"
    };
    attributes.insert("settlementRole".into(), role.into());
    if let Some(realm) = realm {
        attributes.insert("polityId".into(), realm.entity.into());
    }
    let living = place.abandoned.is_none();
    if let Some(rival) = place
        .contested_by
        .filter(|_| living)
        .and_then(|code| traditions.get(code))
    {
        attributes.insert("contestedBy".into(), rival.entity.into());
    }
    Ok(())
}
/// How far a regional capital's towns lie from it, as a share of the map's span: the old
/// society cycle's region.
const REGION: f64 = 0.0375;
/// Whether a town outranks another for a region: by its townsfolk, then by its record.
fn outranks(a: &KnownPlace, b: &KnownPlace) -> bool {
    a.town_people > b.town_people || (a.town_people == b.town_people && a.id < b.id)
}
/// A town governing a region of its realm, as the old society cycle named regional capitals:
/// at least two other towns of its allegiance lie within a region's distance, none of them
/// larger and none of them a realm's seat.
fn regional_capital(
    state: &impl CommunityState,
    place: &KnownPlace,
    allegiance: i32,
) -> io::Result<bool> {
    if allegiance == 0 {
        return Ok(false);
    }
    let field = state.field()?;
    let reach = crate::field::people::travel::length(field, REGION)?;
    let at = field.mesh.position(place.anchor);
    let traditions = state.traditions();
    let mut neighbours = 0;
    for other in &state.known_places().known {
        if other.id == place.id || other.abandoned.is_some() || other.absorbed_by.is_some() {
            continue;
        }
        let there = field.mesh.position(other.anchor);
        if field.mesh.delta_x(at[0] - there[0]).hypot(at[1] - there[1]) > reach {
            continue;
        }
        let held = identity::leading(&field.people.column(other.anchor)?, Tradition::Allegiance).0;
        if held != allegiance {
            continue;
        }
        let seat = traditions
            .known
            .iter()
            .any(|t| t.seat.as_deref() == Some(&other.id));
        if seat || outranks(other, place) {
            return Ok(false);
        }
        neighbours += 1;
    }
    Ok(neighbours >= 2)
}
fn whole(value: f64) -> f64 {
    (value + 0.5).floor()
}
fn country(place: &KnownPlace, attributes: &mut Attributes) {
    let h = place.hinterland.as_ref();
    for (key, value) in [
        ("hinterlandKm2", h.map_or(0.0, |h| h.km2)),
        ("hinterlandPeople", h.map_or(0.0, |h| h.people)),
        ("hinterlandFarmedKm2", h.map_or(0.0, |h| h.farmed_km2)),
        ("hinterlandGrazedKm2", h.map_or(0.0, |h| h.grazed_km2)),
    ] {
        attributes.insert(key.into(), whole(value).into());
    }
}
fn facts(place: &KnownPlace, land: &PlaceLand) -> Attributes {
    let mut attributes = Attributes::new();
    for (key, value) in [
        ("placeKey", json!(place.id)),
        (
            "status",
            json!(if place.abandoned.is_none() {
                "inhabited"
            } else {
                "abandoned"
            }),
        ),
        ("founded", json!(place.founded)),
        ("population", json!(whole(place.town_people))),
        ("settlementPopulation", json!(whole(place.town_people))),
        ("communityPopulation", json!(whole(place.people))),
        (
            "ruralPopulation",
            json!(whole((place.people - place.town_people).max(0.0))),
        ),
        ("peakPopulation", json!(whole(place.peak))),
        ("history", json!(place.history)),
        ("representedAreaKm2", json!(land.zone_km2)),
        ("builtKm2", json!(place.built_km2)),
        ("farmedKm2", json!(land.farmed_km2)),
        ("grazedKm2", json!(land.grazed_km2)),
        ("elevationMetres", json!(whole(land.metres))),
        ("riverOrder", json!(land.river)),
        ("coastal", json!(land.coastal)),
        ("siteKind", json!(land.site_kind)),
        ("siteReason", json!(land.site_reason)),
        ("fortress", json!(false)),
    ] {
        attributes.insert(key.into(), value);
    }
    if let Some(abandoned) = &place.abandoned {
        attributes.insert("abandoned".into(), abandoned.clone().into());
    }
    country(place, &mut attributes);
    attributes
}
fn story(place: &KnownPlace, reason: &str) -> String {
    let gathered = format!("{}: people gathered here {reason}", place.founded);
    match &place.abandoned { Some(era)=>format!("{gathered}. {era}: the place could no longer feed a town, and its {} townsfolk at its height are gone.",whole(place.peak)),None=>format!("{gathered}; {} now live here beyond what the place's own land feeds.",whole(place.town_people)) }
}
fn record(state: &impl CommunityState, place: &KnownPlace, least: f64) -> io::Result<Feature> {
    let land = place_land::place_land(state.field()?, place.anchor, &place.cells)?;
    let traditions = state.traditions();
    let language = place
        .tongue
        .and_then(|code| traditions.get(code))
        .map(|t| t.entity.to_string());
    let named = state.name_community(place, &land, language.as_deref())?;
    let mut attributes = named.metadata;
    attributes.extend(facts(place, &land));
    standing(state, place, least, &mut attributes)?;
    if place.abandoned.is_none() {
        attributes.insert(
            "peoples".into(),
            serde_json::to_value(place_peoples::peoples(state.field()?, &traditions, place)?)?,
        );
    }
    let mut feature = community_records::local_record(
        state,
        Record {
            key: &place.id,
            name: &named.name,
            kind: "settlement",
            layer: if place.abandoned.is_some() {
                "ruins"
            } else {
                "settlements"
            },
            geometry: Geometry::Point {
                coordinates: Position::xy(land.x, land.y),
            },
            attributes,
        },
    )?;
    feature.causes = vec![story(place, &land.site_reason)];
    Ok(feature)
}
pub fn places(state: &impl CommunityState, kind: Kind) -> io::Result<Vec<Place>> {
    if state.physical().is_none() {
        return Ok(Vec::new());
    }
    let known = state.known_places();
    let mut found = Vec::new();
    for place in &known.known {
        if place.absorbed_by.is_some()
            || place.adopted.is_some()
            || (kind == Kind::Ruin) != place.abandoned.is_some()
        {
            continue;
        }
        let cells = if place.cells.is_empty() {
            vec![place.anchor]
        } else {
            place.cells.clone()
        };
        let mut located = Place::at(kind, place.anchor, cells);
        located.id = community_records::local_id(state, &place.id).to_string();
        located.feature = Some(record(state, place, known.town)?);
        found.push(located);
    }
    Ok(found)
}
