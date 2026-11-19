//! Find a building or street by its address ("12 Mill Lane", or "Mill Lane"), over the map's
//! published features only.
use crate::map_store::{space, FeatureQuery, MapAccess, Page};
use atlas_map::{
    authoring::{family, is_building, is_street, street_of},
    town::{AddressMatch, AddressQuery},
    Bounds, MapDescriptor, MapFeature, MapRef,
};
use serde_json::Value;
use std::io;

/// How far from its street a numbered building is looked for, in metres.
const REACH: f64 = 100.0;

/// Buildings at the address, else the plots holding it; for a street name alone, the
/// streets. Exact street names win over names the query only begins.
pub fn find(maps: &dyn MapAccess, reference: &MapRef, text: &str) -> io::Result<Vec<AddressMatch>> {
    let query = AddressQuery::parse(text).ok_or_else(|| {
        io::Error::other("Type an address such as 12 Mill Lane, or a street's name")
    })?;
    let map = maps.open(reference)?;
    let spatial = maps
        .geometry()
        .spatial(space(&map, map.primary_space_id)?.precision)?;
    let mut streets: Vec<_> = features(maps, &map, &["roads"], None)?
        .into_iter()
        .filter(is_street)
        .filter_map(|street| {
            let closeness = query.street_match(street.name.as_deref()?)?;
            Some((closeness, street))
        })
        .collect();
    let best = streets.iter().map(|(closeness, _)| *closeness).min();
    streets.retain(|(closeness, _)| Some(*closeness) == best);
    let mut found = Vec::new();
    for (_, street) in streets {
        let Bounds(w, s, e, n) = spatial.bounds(&street.geometry).map_err(io::Error::other)?;
        let Some(number) = query.number else {
            found.push(matched(
                &street,
                street.name.clone().unwrap_or_default(),
                Bounds(w, s, e, n),
            ));
            continue;
        };
        let near = Bounds(w - REACH, s - REACH, e + REACH, n + REACH);
        let mut holders: Vec<MapFeature> =
            features(maps, &map, &["structures", "plots"], Some(near))?
                .into_iter()
                .filter(|f| street_of(f) == Some(street.id))
                .filter(|f| {
                    f.attributes.get("addressNumber").and_then(Value::as_u64)
                        == Some(u64::from(number))
                })
                .collect();
        if holders.iter().any(is_building) {
            holders.retain(is_building);
        }
        for holder in holders {
            let bounds = spatial.bounds(&holder.geometry).map_err(io::Error::other)?;
            let line = text_of(&holder, "address").unwrap_or_default();
            found.push(matched(&holder, line, bounds));
        }
    }
    Ok(found)
}
fn text_of(feature: &MapFeature, key: &str) -> Option<String> {
    feature
        .attributes
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
}
fn matched(feature: &MapFeature, address: String, bounds: Bounds) -> AddressMatch {
    AddressMatch {
        feature_id: feature.id,
        layer_id: feature.layer_id.clone(),
        kind: feature.kind.clone(),
        name: feature.name.clone(),
        address,
        bounds,
    }
}
fn features(
    maps: &dyn MapAccess,
    map: &MapDescriptor,
    families: &[&str],
    bounds: Option<Bounds>,
) -> io::Result<Vec<MapFeature>> {
    let layers = map
        .layers
        .iter()
        .filter(|layer| {
            families.contains(&family(&layer.id)) && layer.space_id == map.primary_space_id
        })
        .map(|layer| layer.id.clone())
        .collect();
    let mut query = FeatureQuery {
        space_id: map.primary_space_id,
        bounds,
        layer_ids: Some(layers),
        ..Default::default()
    };
    let mut items = Vec::new();
    loop {
        let Page { items: page, next } = maps.features(reference(map), &query)?;
        items.extend(page);
        if next.is_none() {
            return Ok(items);
        }
        query.cursor = next;
    }
}
fn reference(map: &MapDescriptor) -> &MapRef {
    &map.reference
}
