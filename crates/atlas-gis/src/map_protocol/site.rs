//! A structure map's outside context (ADR 0016: interiors still show the outside data,
//! especially magic prevalence). Everything is read from published GIS: the building's
//! record on the parent map, the samples under its footprint and the magic features around
//! it. When the parent publishes no samples there (an authored ground map may carry only
//! shapes), the nearest ancestor in the same located space that does is read instead.
use crate::map_store::{FeatureQuery, MapAccess, Page};
use atlas_map::{
    authoring::family,
    structure::{site_context, SiteContext},
    Bounds, Geometry, Id, MapDescriptor, MapFeature, MapRef, MapSample, Position,
};
use std::io;

/// How far around the building magic features are listed, in metres.
const NEAR: f64 = 150.0;
/// How many ancestor maps are searched for published samples.
const ANCESTORS: usize = 4;

pub fn context(maps: &dyn MapAccess, reference: &MapRef) -> io::Result<SiteContext> {
    let map = maps.open(reference)?;
    let site = map
        .real_scale
        .as_ref()
        .and_then(|real| real.site.clone())
        .ok_or_else(|| io::Error::other("Only a building's floors map has a site"))?;
    let parent = map
        .parent
        .as_ref()
        .ok_or_else(|| io::Error::other("This building's floors map has no parent map"))?;
    let parent = current(maps, parent)?;
    let space = map.primary_space_id;
    let building = all(
        maps,
        &parent,
        FeatureQuery {
            space_id: space,
            feature_ids: Some(vec![site.building_id]),
            ..Default::default()
        },
    )?
    .pop();
    let outline = building
        .as_ref()
        .map(|b| b.geometry.clone())
        .unwrap_or_else(|| frame(map.bounds));
    let points = probes(&outline);
    let centre = points[0];
    let lineage = lineage(maps, parent)?;
    let mut samples = Vec::new();
    for ancestor in &lineage {
        samples = samples_under(maps, ancestor, space, &points)?;
        if !samples.is_empty() {
            break;
        }
    }
    let mut nearby = Vec::new();
    for ancestor in &lineage {
        for feature in magic_near(maps, ancestor, space, centre)? {
            nearby.push((ancestor.reference.map_id, feature));
        }
    }
    let [x, y, _] = centre.coordinates();
    Ok(site_context(
        &site,
        building.as_ref(),
        [x, y],
        &samples,
        &nearby,
    ))
}
/// The map's current revision where it has one; an edited parent keeps its revision.
fn current(maps: &dyn MapAccess, reference: &MapRef) -> io::Result<MapDescriptor> {
    let head = maps.find_head(reference.map_id)?;
    maps.open(head.as_ref().unwrap_or(reference))
}
fn lineage(maps: &dyn MapAccess, parent: MapDescriptor) -> io::Result<Vec<MapDescriptor>> {
    let mut lineage = vec![parent];
    while lineage.len() < ANCESTORS {
        let Some(up) = lineage[lineage.len() - 1].parent.clone() else {
            break;
        };
        match current(maps, &up) {
            Ok(map) => lineage.push(map),
            // An ancestor that is not in this catalogue ends the search.
            Err(_) => break,
        }
    }
    Ok(lineage)
}
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
fn frame(Bounds(w, s, e, n): Bounds) -> Geometry {
    atlas_map::regions::rectangle(Bounds(w, s, e, n))
}
/// The centre of an outline's corners first, then points a fifth of the way in from each
/// corner, so the samples read lie under the building, not beside it.
fn probes(outline: &Geometry) -> Vec<Position> {
    let corners: Vec<[f64; 2]> = match outline {
        Geometry::Polygon { coordinates } => coordinates.first().cloned().unwrap_or_default(),
        Geometry::MultiPolygon { coordinates } => coordinates
            .first()
            .and_then(|polygon| polygon.first())
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    }
    .into_iter()
    .map(|p| {
        let [x, y, _] = p.coordinates();
        [x, y]
    })
    .collect();
    if corners.is_empty() {
        return vec![Position::xy(0.0, 0.0)];
    }
    let n = corners.len() as f64;
    let cx = corners.iter().map(|p| p[0]).sum::<f64>() / n;
    let cy = corners.iter().map(|p| p[1]).sum::<f64>() / n;
    let mut points = vec![Position::xy(cx, cy)];
    points.extend(
        corners
            .iter()
            .map(|[x, y]| Position::xy(x + (cx - x) * 0.2, y + (cy - y) * 0.2)),
    );
    points
}
fn samples_under(
    maps: &dyn MapAccess,
    map: &MapDescriptor,
    space: Id,
    points: &[Position],
) -> io::Result<Vec<MapSample>> {
    if !map.spaces.iter().any(|entry| entry.id == space) {
        return Ok(Vec::new());
    }
    let mut samples: Vec<MapSample> = Vec::new();
    for point in points {
        for sample in maps.samples_at(&map.reference, space, *point)? {
            if !samples.iter().any(|kept| kept.id == sample.id) {
                samples.push(sample);
            }
        }
    }
    Ok(samples)
}
/// Features of the map's magic layers within reach of the building.
fn magic_near(
    maps: &dyn MapAccess,
    map: &MapDescriptor,
    space: Id,
    centre: Position,
) -> io::Result<Vec<MapFeature>> {
    let layers: Vec<String> = map
        .layers
        .iter()
        .filter(|layer| layer.space_id == space && family(&layer.id).starts_with("magic"))
        .map(|layer| layer.id.clone())
        .collect();
    let Some(entry) = map.spaces.iter().find(|entry| entry.id == space) else {
        return Ok(Vec::new());
    };
    if layers.is_empty() {
        return Ok(Vec::new());
    }
    let reach = NEAR / entry.metres_per_unit;
    let [x, y, _] = centre.coordinates();
    all(
        maps,
        map,
        FeatureQuery {
            space_id: space,
            bounds: Some(Bounds(x - reach, y - reach, x + reach, y + reach)),
            layer_ids: Some(layers),
            ..Default::default()
        },
    )
}
