//! Replacement retains names and contracts; final naming reads the people along each feature.
use super::{state::State, world::Sources};
use crate::{
    features::{network, publication::Named, Feature, FeatureSelection, State as FeatureState},
    field::poi::{names, publication::Publication},
    human::identity::{held, Tradition},
};
use atlas_map::{Geometry, Position};
use std::{collections::BTreeMap, io};

pub fn prepare(state: &mut State, domains: &[String]) -> io::Result<()> {
    let features = state
        .records
        .features
        .values(FeatureSelection::default())?
        .collect::<io::Result<Vec<_>>>()?;
    state.records.retained_names.clear();
    let mut contracted = state.scope.contracted.clone();
    for feature in &features {
        state.records.retained_names.insert(
            feature.id,
            Named {
                name: feature.name.clone(),
                metadata: feature
                    .attributes
                    .iter()
                    .filter(|(key, _)| key.starts_with("naming") || *key == "namedInEra")
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            },
        );
        contracted.extend(
            feature
                .relations
                .iter()
                .map(|relation| relation.target_id.clone()),
        );
    }
    for feature in features {
        let selected = domains
            .iter()
            .any(|domain| Some(domain) == feature.generation_domain.as_ref())
            || (feature.layer_id == "ecology" && domains.iter().any(|domain| domain == "magic"));
        if feature.area_id != state.scope.area
            || feature.state != FeatureState::Generated
            || !selected
            || feature.protected
            || !feature.detail.is_empty()
            || contracted.contains(&feature.id)
            || (feature.place_id.is_some() && matches!(feature.geometry, Geometry::Point { .. }))
        {
            continue;
        }
        state.records.features.remove(feature.id)?;
        let reaches = state
            .records
            .networks
            .reaches(network::Selection {
                feature_id: Some(feature.id),
                ..Default::default()
            })?
            .collect::<io::Result<Vec<_>>>()?;
        for reach in reaches {
            state.records.networks.remove_reach(reach.id)?;
        }
    }
    Ok(())
}
const SOUNDINGS: usize = 64;
fn along(shape: &Geometry) -> Vec<Position> {
    let all = match shape {
        Geometry::Point { coordinates } => vec![*coordinates],
        Geometry::MultiPoint { coordinates } | Geometry::LineString { coordinates } => {
            coordinates.clone()
        }
        Geometry::MultiLineString { coordinates } | Geometry::Polygon { coordinates } => {
            coordinates.iter().flatten().copied().collect()
        }
        Geometry::MultiPolygon { coordinates } => {
            coordinates.iter().flatten().flatten().copied().collect()
        }
        Geometry::GeometryCollection { geometries } => geometries.iter().flat_map(along).collect(),
    };
    let every = all.len().div_ceil(SOUNDINGS).max(1);
    all.into_iter().step_by(every).collect()
}
fn speakers(state: &State, feature: &Feature) -> io::Result<Vec<(String, f64)>> {
    let mesh = state.field().mesh();
    let [ox, oy] = mesh.origin();
    let memory = state.people.memory.borrow();
    let mut weights = BTreeMap::<String, f64>::new();
    for point in along(&feature.geometry) {
        let [x, y, _] = point.coordinates();
        let Some(cell) = mesh.cell_at(x - ox, y - oy) else {
            continue;
        };
        for (code, people) in held(&state.field().people().column(cell)?, Tradition::Tongue) {
            if let Some(tongue) = memory.traditions.get(code) {
                // Languages reach the naming library as its text keys.
                *weights.entry(tongue.entity.to_string()).or_default() += people;
            }
        }
    }
    Ok(weights
        .into_iter()
        .filter(|(_, people)| *people > 0.0)
        .collect())
}
fn unnamed(state: &State, original: &Sources, feature: &Feature) -> io::Result<bool> {
    Ok(feature.area_id == state.scope.area
        && feature.state == FeatureState::Generated
        && !feature.protected
        && original.features.get(feature.id)?.is_none()
        && !feature.attributes.get("namedInEra").is_some_and(truthy)
        && feature.attributes.get("namingKind").is_some_and(truthy))
}
fn truthy(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::String(value) => !value.is_empty(),
        serde_json::Value::Number(value) => value.as_f64().is_some_and(|v| v != 0.0),
        _ => true,
    }
}
pub fn finalize(
    state: &mut State,
    original: &Sources,
    publication: &Publication,
    era: &str,
) -> io::Result<()> {
    let features = state
        .records
        .features
        .values(FeatureSelection::default())?
        .collect::<io::Result<Vec<_>>>()?;
    for mut feature in features {
        if !unnamed(state, original, &feature)? {
            continue;
        }
        if let Some(named) = state.naming.inhabited_feature(
            &state.scope,
            &feature,
            &speakers(state, &feature)?,
            era,
        )? {
            feature.name = named.named.name;
            feature.attributes.extend(named.named.metadata);
            if let Some(language) = named.language {
                let memory = state.people.memory.borrow();
                let name = memory
                    .entities
                    .get(&language.parse().unwrap_or_default())
                    .map_or(language.as_str(), |e| e.name.as_str());
                feature
                    .causes
                    .push(format!("Named during {era} from local use of {name}."));
            }
        }
        state.records.features.put(feature)?;
    }
    let catalogue = state.catalogue.clone();
    names::take_names(state, &catalogue, &publication.written)?;
    state.retain_river_names()
}
