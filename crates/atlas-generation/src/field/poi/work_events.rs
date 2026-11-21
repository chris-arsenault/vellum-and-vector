use super::{
    community_records::{self, CommunityState},
    kinds::Kind,
    map_records::{self, Record},
    sites::Sites,
    values::Place,
    work_records::{self, WorkState},
};
use crate::{
    features::{records::Attributes, Feature, FeatureSelection},
    field::{
        people::{events::Event, frontiers},
        refinement::topology::distance,
    },
    hpc::{Direction, KeyedHeap},
};
use atlas_map::Geometry;
use serde_json::json;
use std::{io, rc::Rc};

fn reach(state: &impl WorkState, event: &Event) -> io::Result<f64> {
    let cells = state
        .known_places()
        .known
        .iter()
        .find(|p| p.id == event.place)
        .map_or(1, |p| p.cells.len());
    Ok(state.field()?.mesh.spacing() * (cells as f64 / std::f64::consts::PI).sqrt())
}
fn event_feature(state: &impl WorkState, event: &Event) -> io::Result<Feature> {
    let mut attributes = Attributes::new();
    for (key, value) in [
        ("eventId", json!(event.id)),
        (
            "atPlace",
            json!(community_records::local_id(
                state,
                state.known_places().standing_place(&event.place)
            )),
        ),
        ("eventKind", json!(event.kind)),
        ("era", json!(event.era)),
        ("radius", json!(reach(state, event)?)),
        ("casualties", json!(event.casualties)),
        ("displaced", json!(event.displaced)),
        (
            "refugeAt",
            json!(event.refuge.as_ref().map(|id| community_records::local_id(
                state,
                state.known_places().standing_place(id)
            ))),
        ),
        ("townsfolk", json!(event.townsfolk)),
        ("magnitude", json!(event.magnitude)),
    ] {
        attributes.insert(key.into(), value);
    }
    let mut feature = community_records::local_record(
        state,
        Record {
            key: &event.id,
            name: &format!("{} — {}", event.kind, event.era),
            kind: "societyEvent",
            layer: "historicalEvents",
            geometry: Geometry::Point {
                coordinates: map_records::native_position(state, event.cell)?,
            },
            attributes,
        },
    )?;
    feature.causes = event.causes.clone();
    Ok(feature)
}
fn captured(
    state: &impl CommunityState,
    kind: Kind,
    matches: &impl Fn(&str) -> bool,
) -> io::Result<Vec<Place>> {
    let mut places = Vec::new();
    for feature in state.features().values(FeatureSelection {
        area_id: Some(state.area_id()),
        kind: Some("societyEvent"),
        ..Default::default()
    })? {
        let feature = feature?;
        if matches(
            feature
                .attributes
                .get("eventKind")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        ) {
            places.push(work_records::positioned_record(state, kind, feature));
        }
    }
    Ok(places)
}
pub fn places(
    state: &impl WorkState,
    kind: Kind,
    matches: impl Fn(&str) -> bool,
) -> io::Result<Rc<Vec<Place>>> {
    state.held().get(&format!("places:{}", kind.as_str()), || {
        if !community_records::developed(state) {
            return Ok(Vec::new());
        }
        let mut places = if state.regional() {
            captured(state, kind, &matches)?
        } else {
            let mut found = Vec::new();
            for event in &state.known_events().known {
                if !matches(&event.kind) || (event.kind == "famine" && event.casualties < 10000.0) {
                    continue;
                }
                let mut place = Place::at(kind, event.cell, vec![event.cell]);
                place.id = community_records::local_id(state, &event.id).to_string();
                place.feature = Some(event_feature(state, event)?);
                found.push(place);
            }
            found
        };
        places.retain(|p| p.anchor != usize::MAX || state.physical().is_none());
        Ok(places)
    })
}
fn frontier_feature(
    state: &impl WorkState,
    key: &str,
    era: &str,
    anchor: usize,
    names: &str,
) -> io::Result<Feature> {
    let mut attributes = Attributes::new();
    for (key, value) in [
        ("eventKind", json!("battle")),
        ("era", json!(era)),
        ("radius", json!(0)),
        ("casualties", json!(0)),
        ("displaced", json!(0)),
        ("magnitude", json!(0.5)),
        ("sited", json!(true)),
    ] {
        attributes.insert(key.into(), value);
    }
    let mut feature = community_records::local_record(
        state,
        Record {
            key: &format!("event:{key}"),
            name: &format!("Field of {names}"),
            kind: "societyEvent",
            layer: "historicalEvents",
            geometry: Geometry::Point {
                coordinates: map_records::native_position(state, anchor)?,
            },
            attributes,
        },
    )?;
    feature.causes = vec![format!(
        "Held frontier between {names}: the way between them is the way armies take."
    )];
    Ok(feature)
}
pub fn frontiers(state: &impl WorkState, kind: Kind, spacing: f64) -> io::Result<Vec<Place>> {
    if state.physical().is_none() || state.regional() {
        return Ok(Vec::new());
    }
    let field = state.field()?;
    let events = state.known_events();
    let era = events.era.as_deref().unwrap_or("Settlement");
    let known_ways = state.known_ways();
    let known_places = state.known_places();
    let ways = frontiers::ways(field, &known_places, &known_ways)?;
    let mut ranked = KeyedHeap::new([Direction::Descending], Direction::Ascending);
    for (at, frontier) in ways.iter().enumerate() {
        ranked.push(at as u32, [frontier.way.travellers]);
    }
    let mut taken = Vec::new();
    let mut places = Vec::new();
    while let Some((at, _)) = ranked.pop() {
        let frontier = &ways[at as usize];
        let way = frontier.way;
        let Some(&cell) = way.cells.get(way.cells.len() / 2) else {
            continue;
        };
        if field.water().column.kind.get(cell)? != 0 {
            continue;
        }
        if Sites::new(state.spatial(), &field.mesh, taken.clone())?
            .nearest(&field.mesh, cell)?
            .is_some_and(|other| distance(&field.mesh, other, cell) < spacing)
        {
            continue;
        }
        taken.push(cell);
        let key = format!("frontier:{}:{}", way.from, way.to);
        let names = format!(
            "{} and {}",
            state
                .tradition_name(frontier.held[0])
                .as_deref()
                .unwrap_or("a realm"),
            state
                .tradition_name(frontier.held[1])
                .as_deref()
                .unwrap_or("a realm")
        );
        let mut place = Place::at(kind, cell, vec![cell]);
        place.id = community_records::local_id(state, &format!("event:{key}")).to_string();
        place.feature = Some(frontier_feature(state, &key, era, cell, &names)?);
        places.push(place);
    }
    Ok(places)
}
