//! Every building and street an edit makes, moves or reshapes is checked against the map
//! around it (`atlas_map::authoring::clearance`): a building keeps off water, ways, other
//! buildings and plots but its own; a street keeps off buildings and crosses only water its
//! settlement can bridge. A placed or moved building that would stand there is refused.
use super::{change::Scope, other};
use crate::map_store::FeatureQuery;
use atlas_map::{
    authoring::{building_clear, family, is_building, is_street, plot_under, street_clear, Draft},
    regions::point,
    town::{bridge_span, Size},
    Bounds, Geometry, MapFeature,
};
use serde_json::Value;
use std::io;

/// The families a building or street is checked against.
const AROUND: [&str; 6] = ["rivers", "lakes", "oceans", "roads", "structures", "plots"];

pub(super) fn check(scope: &Scope<'_>, draft: &Draft) -> io::Result<()> {
    for feature in draft.after.iter().filter(|f| moved(draft, f)) {
        if !(is_building(feature) || is_street(feature)) {
            continue;
        }
        let around = around(scope, draft, &feature.geometry)?;
        let checked = if is_building(feature) {
            let own = plot_under(feature, &around, scope.spatial).map_err(other)?;
            building_clear(feature, &around, own.map(|p| p.id), scope.spatial)
        } else {
            let span = bridge_span(size_of(scope, feature)?);
            street_clear(feature, &around, span, scope.spatial)
        };
        checked.map_err(other)?;
    }
    Ok(())
}
/// A feature the edit made or whose shape it changed.
fn moved(draft: &Draft, feature: &MapFeature) -> bool {
    draft
        .before
        .iter()
        .find(|old| old.id == feature.id)
        .is_none_or(|old| old.geometry != feature.geometry)
}
/// The features near a shape as they will stand after the edit.
fn around(scope: &Scope<'_>, draft: &Draft, geometry: &Geometry) -> io::Result<Vec<MapFeature>> {
    let Bounds(w, s, e, n) = scope.spatial.bounds(geometry).map_err(other)?;
    let layers = scope
        .map
        .layers
        .iter()
        .filter(|layer| AROUND.contains(&family(&layer.id)))
        .map(|layer| layer.id.clone())
        .collect();
    let query = FeatureQuery {
        space_id: scope.map.primary_space_id.clone(),
        bounds: Some(Bounds(w - 1.0, s - 1.0, e + 1.0, n + 1.0)),
        layer_ids: Some(layers),
        ..Default::default()
    };
    let changed = |f: &MapFeature| {
        draft
            .before
            .iter()
            .chain(&draft.after)
            .any(|d| d.id == f.id)
    };
    let mut found: Vec<MapFeature> = scope
        .store
        .all(scope.map, query)?
        .into_iter()
        .filter(|f| !changed(f))
        .collect();
    found.extend(draft.after.iter().cloned());
    Ok(found)
}
/// The size of the settlement a street belongs to; a street of none counts as a village's.
fn size_of(scope: &Scope<'_>, street: &MapFeature) -> io::Result<Size> {
    let named = street.attributes.get("settlement").and_then(Value::as_str);
    let layers = scope
        .map
        .layers
        .iter()
        .filter(|layer| family(&layer.id) == "settlements")
        .map(|layer| layer.id.clone())
        .collect();
    let query = FeatureQuery {
        space_id: scope.map.primary_space_id.clone(),
        layer_ids: Some(layers),
        ..Default::default()
    };
    let places: Vec<MapFeature> = scope
        .store
        .all(scope.map, query)?
        .into_iter()
        .filter(|f| matches!(f.geometry, Geometry::Point { .. }))
        .collect();
    let start = scope
        .spatial
        .interior_position(&street.geometry)
        .map_err(other)?;
    let mut best: Option<(&MapFeature, f64)> = None;
    for place in &places {
        let gap = scope
            .spatial
            .distance(&point(start), &place.geometry)
            .map_err(other)?;
        let preferred = named.is_some() && place.name.as_deref() == named;
        if preferred || best.is_none_or(|(_, d)| gap < d) {
            best = Some((place, if preferred { f64::NEG_INFINITY } else { gap }));
        }
    }
    let people = best.and_then(|(place, _)| {
        ["settlementPopulation", "population"]
            .iter()
            .find_map(|key| place.attributes.get(*key).and_then(Value::as_f64))
    });
    Ok(people.map_or(Size::Village, Size::of))
}
