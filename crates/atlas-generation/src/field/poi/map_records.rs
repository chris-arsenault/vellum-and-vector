//! Generated feature identities, names and geographic record attributes.
use super::state::State;
use crate::{
    features::{
        chart::Chart,
        publication::Named,
        records::{Attributes, Relation},
        Feature, State as FeatureState,
    },
    identity::semantic_id,
    rock::ground::GroundField,
    scale::{LengthUnit, MapScale},
};
use atlas_map::{Geometry, Position};
use serde_json::json;
use std::io;

pub trait MapState: State {
    fn geometry_precision(&self) -> f64;
    fn chart(&self) -> Chart<'_>;
    fn footprint(&self) -> &Geometry;
    fn world_id(&self) -> &str;
    fn area_id(&self) -> &str;
    fn area_name(&self) -> &str;
    fn generation_domain(&self, layer: &str) -> Option<String>;
    fn geographic_name(
        &self,
        key: &str,
        kind: &str,
        geometry: &Geometry,
        attributes: &Attributes,
    ) -> io::Result<Option<Named>>;
    fn retained_feature_name(&self, id: &str) -> Option<&Named>;
}
pub struct Record<'a> {
    pub key: &'a str,
    pub name: &'a str,
    pub kind: &'a str,
    pub layer: &'a str,
    pub geometry: Geometry,
    pub attributes: Attributes,
}
pub fn generated(state: &impl MapState, record: Record<'_>) -> io::Result<Feature> {
    let geometry = if matches!(
        record.geometry,
        Geometry::LineString { .. } | Geometry::MultiLineString { .. }
    ) {
        record.geometry
    } else {
        state
            .chart()
            .geometry(&record.geometry, state.spatial())
            .map_err(io::Error::other)?
    };
    let id = semantic_id(
        state.world_id(),
        &format!("generated:{}", state.area_id()),
        record.key,
    )?;
    let named = state.geographic_name(record.key, record.kind, &geometry, &record.attributes)?;
    let previous = state.retained_feature_name(&id);
    let name = previous
        .or(named.as_ref())
        .map_or(record.name, |named| &named.name)
        .to_owned();
    let mut attributes = Attributes::new();
    attributes.insert(
        "nameStatus".into(),
        if ["furniture", "wall", "door", "room", "building"].contains(&record.kind) {
            "label"
        } else {
            "proper"
        }
        .into(),
    );
    attributes.extend(record.attributes);
    if let Some(named) = named {
        attributes.extend(named.metadata);
    }
    if let Some(previous) = previous {
        attributes.extend(previous.metadata.clone());
    }
    Ok(Feature {
        id,
        name,
        kind: record.kind.into(),
        layer_id: record.layer.into(),
        area_id: state.area_id().into(),
        geometry,
        attributes,
        place_id: None,
        map_only: None,
        footprint: None,
        detail: Default::default(),
        relations: Vec::new(),
        state: FeatureState::Generated,
        protected: false,
        actor: "generator".into(),
        generation_id: None,
        generation_domain: state.generation_domain(record.layer),
        causes: vec![format!(
            "Generated from {} in {}.",
            record.key,
            state.area_name()
        )],
    })
}
pub fn native_position(state: &impl State, cell: usize) -> io::Result<Position> {
    let mesh = &state.field()?.mesh;
    let [x, y] = mesh.position(cell);
    let [ox, oy] = mesh.origin();
    Ok(Position::XYZ([x + ox, y + oy, 0.0]))
}
pub fn representative(state: &impl MapState, members: &[usize]) -> io::Result<Option<usize>> {
    let positions = members
        .iter()
        .map(|&cell| Ok(state.chart().position(native_position(state, cell)?)))
        .collect::<io::Result<Vec<_>>>()?;
    let covered = state
        .spatial()
        .covers_points(state.footprint(), &positions)
        .map_err(io::Error::other)?;
    let elevations = state.field()?.ground().view(GroundField::Elevation);
    let mut best = None;
    for (&cell, covered) in members.iter().zip(covered) {
        if covered && (best.is_none() || elevations.get(cell)? > elevations.get(best.unwrap())?) {
            best = Some(cell);
        }
    }
    Ok(best)
}
pub struct Placement {
    pub geometry: Geometry,
    pub anchor: usize,
    pub meaning: &'static str,
}
pub struct PlaceRecord<'a> {
    pub kind: &'a str,
    pub name: &'a str,
    pub members: &'a [usize],
    pub layer: &'a str,
    pub attributes: Attributes,
    pub extent: Option<Geometry>,
    pub placement: Option<Placement>,
    pub relations: Vec<Relation>,
}
pub fn place_feature(state: &impl MapState, place: PlaceRecord<'_>) -> io::Result<Option<Feature>> {
    let Some(representative) = representative(state, place.members)? else {
        return Ok(None);
    };
    let identity = state
        .chart()
        .position(native_position(state, representative)?);
    let [x, y, _] = identity.coordinates();
    let geometry = place
        .placement
        .as_ref()
        .map(|p| p.geometry.clone())
        .or_else(|| place.extent.clone())
        .unwrap_or(Geometry::Point {
            coordinates: identity,
        });
    let anchor = place
        .placement
        .as_ref()
        .map_or(representative, |p| p.anchor);
    let [ax, ay, az] = state
        .chart()
        .position(native_position(state, anchor)?)
        .coordinates();
    let field = state.field()?;
    let area = match &place.extent {
        Some(extent) => state.spatial().area(extent).map_err(io::Error::other)?,
        None => place
            .members
            .iter()
            .map(|&cell| field.mesh.area(cell))
            .sum(),
    };
    let mut attributes = Attributes::new();
    attributes.insert("sourceAlgorithm".into(), "atlas-1".into());
    attributes.insert("area".into(), area.into());
    attributes.insert(
        "representative".into(),
        json!({ "x": ax, "y": ay, "z": az }),
    );
    attributes.insert("placeType".into(), place.name.into());
    attributes.insert(
        "geometryMeaning".into(),
        place
            .placement
            .as_ref()
            .map_or("classified geographic region", |p| p.meaning)
            .into(),
    );
    attributes.insert(
        "elevation".into(),
        MapScale::metres(
            field.ground().view(GroundField::Elevation).get(anchor)?,
            LengthUnit::Native,
        )
        .into(),
    );
    attributes.extend(place.attributes);
    let key = format!(
        "{}:{:.6}:{:.6}",
        place.kind,
        if x == 0.0 { 0.0 } else { x },
        if y == 0.0 { 0.0 } else { y }
    );
    let mut feature = generated(
        state,
        Record {
            key: &key,
            name: place.name,
            kind: place.kind,
            layer: place.layer,
            geometry,
            attributes,
        },
    )?;
    if !matches!(
        feature.geometry,
        Geometry::Polygon { .. } | Geometry::MultiPolygon { .. }
    ) {
        feature.footprint = place.extent;
    }
    feature.relations = place.relations;
    Ok(Some(feature))
}
pub fn site(
    state: &impl MapState,
    place: &super::values::Place,
    kind: &str,
    layer: &str,
    name: &str,
    attributes: Attributes,
) -> io::Result<Option<Feature>> {
    place_feature(
        state,
        PlaceRecord {
            kind,
            name,
            members: &place.cells,
            layer,
            attributes,
            extent: None,
            relations: Vec::new(),
            placement: Some(Placement {
                geometry: Geometry::Point {
                    coordinates: native_position(state, place.anchor)?,
                },
                anchor: place.anchor,
                meaning: "located site",
            }),
        },
    )
}
