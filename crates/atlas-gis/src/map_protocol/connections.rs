//! What a stair, ladder or trapdoor may connect to, read from published GIS: the connection
//! features on its map's other levels and, under the building, the features of the parent
//! map the connection rule lets it reach (`atlas_map::structure::candidates`).
use crate::map_store::{FeatureQuery, MapAccess, Page};
use atlas_map::{
    authoring::family,
    structure::{candidates, vocabulary, ConnectionCandidate},
    MapDescriptor, MapFeature, MapRef,
};
use std::io;

fn all(
    maps: &dyn MapAccess,
    map: &MapDescriptor,
    mut query: FeatureQuery,
) -> io::Result<Vec<MapFeature>> {
    let mut items = Vec::new();
    loop {
        let Page { items: page, next } = maps.features(&map.reference, &query)?;
        items.extend(page);
        if next.is_none() {
            return Ok(items);
        }
        query.cursor = next;
    }
}
/// Features of the layers `keep` accepts, in every space of a map, within its bounds or `near`.
fn in_layers(
    maps: &dyn MapAccess,
    map: &MapDescriptor,
    keep: impl Fn(&str) -> bool,
    near: atlas_map::Bounds,
) -> io::Result<Vec<MapFeature>> {
    let mut found = Vec::new();
    for space in &map.spaces {
        let layers: Vec<String> = map
            .layers
            .iter()
            .filter(|layer| layer.space_id == space.id && keep(family(&layer.id)))
            .map(|layer| layer.id.clone())
            .collect();
        if layers.is_empty() {
            continue;
        }
        let query = FeatureQuery {
            space_id: space.id.clone(),
            bounds: Some(near),
            layer_ids: Some(layers),
            ..Default::default()
        };
        found.extend(all(maps, map, query)?);
    }
    Ok(found)
}
pub fn candidates_for(
    maps: &dyn MapAccess,
    reference: &MapRef,
    feature_id: atlas_map::Id,
) -> io::Result<Vec<ConnectionCandidate>> {
    let map = maps.open(reference)?;
    let own = in_layers(maps, &map, |family| family == "structures", map.bounds)?;
    let source = own
        .iter()
        .find(|feature| feature.id == feature_id)
        .ok_or_else(|| io::Error::other("Choose a stair, ladder or trapdoor on this map"))?;
    let parent = match &map.parent {
        Some(parent) => {
            let head = maps.find_head(parent.map_id)?;
            Some(maps.open(head.as_ref().unwrap_or(parent))?)
        }
        None => None,
    };
    let rule = &vocabulary().connections;
    let reachable = |family: &str| {
        family == "structures" || rule.reaches_layers.iter().any(|layer| layer == family)
    };
    let under = match &parent {
        Some(parent) => in_layers(maps, parent, reachable, map.bounds)?,
        None => Vec::new(),
    };
    Ok(candidates(
        &map,
        source,
        &own,
        parent.as_ref().map(|parent| (parent, under.as_slice())),
    ))
}
