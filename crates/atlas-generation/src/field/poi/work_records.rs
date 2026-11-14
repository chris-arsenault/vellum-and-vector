use super::{
    community_records::{self, CommunityState},
    contract::OnCell,
    kinds::Kind,
    map_records::{self, Record},
    places, reads,
    river_courses::RiverState,
    sites::Sites,
    values::Place,
};
use crate::{
    features::{records::Attributes, Feature, State as FeatureState},
    field::{
        people::{events::Events, place_country::KnownWay},
        refinement::topology::distance,
    },
    scale::RelativeMeasure,
};
use atlas_map::Geometry;
use serde_json::json;
use std::{cell::Ref, io, rc::Rc};

pub trait WorkState: CommunityState + RiverState {
    fn known_events(&self) -> Ref<'_, Events>;
    fn known_ways(&self) -> Ref<'_, [KnownWay]>;
    fn tradition_name(&self, code: i32) -> Option<String>;
}
pub struct SitedWork<S> {
    pub record: &'static str,
    pub layer: &'static str,
    pub label: &'static str,
    pub radius: RelativeMeasure,
    pub spacing: RelativeMeasure,
    pub requires: OnCell<S, bool>,
    pub suitability: OnCell<S, f64>,
}
pub struct RememberedWork {
    pub key: String,
    pub cell: usize,
    pub attributes: Attributes,
    pub causes: Option<Vec<String>>,
}
fn nearest_town(state: &impl CommunityState, cell: usize) -> io::Result<Option<String>> {
    let towns = community_records::places(state, Kind::Settlement)?;
    let sites = Sites::new(
        state.spatial(),
        &state.field()?.mesh,
        towns.iter().map(|p| p.anchor).collect(),
    )?;
    Ok(sites.nearest(&state.field()?.mesh, cell)?.and_then(|cell| {
        towns
            .iter()
            .find(|p| p.anchor == cell)
            .map(|p| p.id.clone())
    }))
}
fn work_feature<S: CommunityState>(
    state: &S,
    shape: &SitedWork<S>,
    work: RememberedWork,
) -> io::Result<Feature> {
    let at = map_records::native_position(state, work.cell)?;
    let [x, y, z] = at.coordinates();
    let mut attributes = Attributes::new();
    for (key, value) in [
        ("workKind", json!(shape.record)),
        ("sited", json!(true)),
        ("site", json!({"x":x,"y":y,"z":z})),
        (
            "radius",
            json!(state
                .field()?
                .scale
                .resolve(shape.radius)
                .map_err(io::Error::other)?
                .value()),
        ),
        ("magnitude", json!(1)),
        ("condition", json!(1)),
        ("maintained", json!(true)),
    ] {
        attributes.insert(key.into(), value);
    }
    if let Some(seat) = nearest_town(state, work.cell)? {
        attributes.insert("seat".into(), seat.into());
    }
    attributes.extend(work.attributes);
    let mut feature = community_records::local_record(
        state,
        Record {
            key: &work.key,
            name: shape.label,
            kind: shape.record,
            layer: shape.layer,
            geometry: Geometry::Point { coordinates: at },
            attributes,
        },
    )?;
    if let Some(causes) = work.causes {
        feature.causes = causes;
    }
    Ok(feature)
}
fn placed<S: CommunityState>(
    state: &S,
    kind: Kind,
    shape: &SitedWork<S>,
    work: RememberedWork,
) -> io::Result<Place> {
    let mut place = Place::at(kind, work.cell, vec![work.cell]);
    place.id = community_records::local_id(state, &work.key)?;
    place.feature = Some(work_feature(state, shape, work)?);
    Ok(place)
}
fn ground_places<S: CommunityState>(
    state: &S,
    kind: Kind,
    shape: &SitedWork<S>,
    remembered: &[Place],
) -> io::Result<Vec<Place>> {
    let Some(field) = state.physical() else {
        return Ok(Vec::new());
    };
    let spacing = field
        .scale
        .resolve(shape.spacing)
        .map_err(io::Error::other)?
        .value();
    let found = places::sited_places(
        state,
        kind,
        |cell| (shape.requires)(state, cell),
        |cell| (shape.suitability)(state, cell),
        spacing,
    )?;
    let sites = Sites::new(
        state.spatial(),
        &field.mesh,
        remembered
            .iter()
            .filter(|p| p.anchor != usize::MAX)
            .map(|p| p.anchor)
            .collect(),
    )?;
    let mut places = Vec::new();
    for place in found.iter() {
        if sites
            .nearest(&field.mesh, place.anchor)?
            .is_some_and(|other| distance(&field.mesh, place.anchor, other) < spacing)
        {
            continue;
        }
        places.push(placed(
            state,
            kind,
            shape,
            RememberedWork {
                key: format!("{}:{}", kind.as_str(), place.anchor),
                cell: place.anchor,
                attributes: Attributes::new(),
                causes: None,
            },
        )?);
    }
    Ok(places)
}
pub fn work_places<S: CommunityState>(
    state: &S,
    kind: Kind,
    shape: &SitedWork<S>,
    remembered: impl FnOnce() -> io::Result<Vec<RememberedWork>>,
) -> io::Result<Rc<Vec<Place>>> {
    state.held().get(&format!("places:{}", kind.as_str()), || {
        if !community_records::developed(state) {
            return Ok(Vec::new());
        }
        let mut raised = Vec::new();
        if !state.regional() {
            for work in remembered()? {
                raised.push(placed(state, kind, shape, work)?);
            }
        }
        let ground = ground_places(state, kind, shape, &raised)?;
        raised.extend(ground);
        Ok(raised)
    })
}
pub fn work_record(state: &impl CommunityState, place: &Place) -> io::Result<Option<Feature>> {
    if place
        .feature
        .as_ref()
        .is_some_and(|f| f.state == FeatureState::Generated)
    {
        community_records::once_written(state, place)
    } else {
        Ok(None)
    }
}
pub fn positioned_record(state: &impl CommunityState, kind: Kind, feature: Feature) -> Place {
    let anchor = state
        .physical()
        .and_then(|field| reads::feature_cell(field, &feature));
    let mut place = Place::at(
        kind,
        anchor.unwrap_or(usize::MAX),
        anchor.into_iter().collect(),
    );
    place.id = feature.id.clone();
    place.feature = Some(feature);
    place
}
