//! Reuse semantic identities and names across resampling, preserving authored network anchors.
use super::{
    network::{NetworkReader, NetworkWorkspace, Selection},
    Feature, FeatureReader, FeatureSelection, FeatureWorkspace, State,
};
use crate::spatial::SpatialKernel;
use atlas_map::{Bounds, Geometry, Position};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

/// Readers supply the captured procedural records, excluding map-only drawings and their reaches.
pub struct Original<'a> {
    pub features: &'a dyn FeatureReader,
    pub networks: &'a dyn NetworkReader,
    pub contracted: &'a dyn Fn(&str) -> bool,
}
pub struct Working<'a> {
    pub features: &'a mut dyn FeatureWorkspace,
    pub networks: &'a mut dyn NetworkWorkspace,
}
fn preserve(source: &Original<'_>, feature: &Feature) -> bool {
    feature.protected
        || feature.state == State::Authored
        || !feature.detail.is_empty()
        || (source.contracted)(&feature.id)
}
fn movable(source: &Original<'_>, feature: &Feature) -> io::Result<bool> {
    Ok(source.features.get(&feature.id)?.is_none() || !preserve(source, feature))
}
fn move_coordinate(shape: &mut Geometry, start: bool, end: bool, point: [f64; 3]) {
    if let Geometry::LineString { coordinates } = shape {
        let anchored = |p| match p {
            Position::XY(_) => Position::xy(point[0], point[1]),
            Position::XYZ(_) => Position::XYZ(point),
        };
        if start {
            if let Some(first) = coordinates.first_mut() {
                *first = anchored(*first);
            }
        }
        if end {
            if let Some(last) = coordinates.last_mut() {
                *last = anchored(*last);
            }
        }
    }
}
fn align_elevation(feature: &mut Feature, start: bool, end: bool, height: f64) {
    if let Some(Value::Array(elevations)) = feature.attributes.get_mut("elevations") {
        if start {
            if let Some(first) = elevations.first_mut() {
                *first = height.into();
            }
        }
        if end {
            if let Some(last) = elevations.last_mut() {
                *last = height.into();
            }
        }
    }
}
fn move_endpoint(
    work: &mut Working<'_>,
    source: &Original<'_>,
    node: &str,
    anchor: &str,
) -> io::Result<()> {
    if node == anchor {
        return Ok(());
    }
    let Some(anchor) = source.networks.node(anchor)? else {
        return Ok(());
    };
    work.networks.put_node(anchor.clone())?;
    let reaches = work
        .networks
        .reaches(Selection {
            node_id: Some(node),
            feature_id: None,
        })?
        .collect::<io::Result<Vec<_>>>()?;
    for mut reach in reaches {
        let (start, end) = (reach.start == node, reach.end == node);
        if !start && !end {
            continue;
        }
        let Some(mut feature) = work.features.get(&reach.feature_id)? else {
            continue;
        };
        if !movable(source, &feature)? {
            continue;
        }
        let p = anchor.position;
        move_coordinate(&mut reach.geometry, start, end, [p.x, p.y, p.z]);
        move_coordinate(&mut feature.geometry, start, end, [p.x, p.y, p.z]);
        align_elevation(&mut feature, start, end, p.z);
        work.features.put(feature)?;
        if start {
            reach.start.clone_from(&anchor.id);
        }
        if end {
            reach.end.clone_from(&anchor.id);
        }
        work.networks.put_reach(reach)?;
    }
    Ok(())
}
fn anchor_junctions(
    work: &mut Working<'_>,
    source: &Original<'_>,
    next: &Feature,
    previous: &Feature,
) -> io::Result<()> {
    let old = source
        .networks
        .reaches(Selection {
            feature_id: Some(&previous.id),
            node_id: None,
        })?
        .collect::<io::Result<Vec<_>>>()?;
    let (Some(first), Some(last)) = (old.first(), old.last()) else {
        return Ok(());
    };
    let reaches = work
        .networks
        .reaches(Selection {
            feature_id: Some(&next.id),
            node_id: None,
        })?
        .collect::<io::Result<Vec<_>>>()?;
    for reach in reaches {
        move_endpoint(work, source, &reach.start, &first.start)?;
        move_endpoint(work, source, &reach.end, &last.end)?;
    }
    Ok(())
}
fn restore_network(work: &mut Working<'_>, source: &Original<'_>, id: &str) -> io::Result<()> {
    for reach in source.networks.reaches(Selection {
        feature_id: Some(id),
        node_id: None,
    })? {
        let reach = reach?;
        for node in [&reach.start, &reach.end] {
            if let Some(node) = source.networks.node(node)? {
                work.networks.put_node(node)?;
            }
        }
        work.networks.put_reach(reach)?;
    }
    Ok(())
}
fn reuse(
    work: &mut Working<'_>,
    source: &Original<'_>,
    mut next: Feature,
    previous: Feature,
) -> io::Result<()> {
    let held = preserve(source, &previous);
    if held {
        anchor_junctions(work, source, &next, &previous)?;
    }
    let next_id = next.id.clone();
    let previous_id = previous.id.clone();
    if next_id != previous_id {
        work.features.remove(&next_id)?;
    }
    if held {
        work.features.put(previous)?;
    } else {
        next.id.clone_from(&previous_id);
        if previous.place_id.as_ref().is_some_and(|id| !id.is_empty()) {
            next.place_id = previous.place_id;
        }
        next.name = previous.name;
        next.relations = previous.relations;
        next.attributes.extend(
            previous
                .attributes
                .into_iter()
                .filter(|(key, _)| key.starts_with("naming") || key == "namedInEra"),
        );
        work.features.put(next)?;
    }
    let reaches = work
        .networks
        .reaches(Selection {
            feature_id: Some(&next_id),
            node_id: None,
        })?
        .collect::<io::Result<Vec<_>>>()?;
    for mut reach in reaches {
        if held {
            work.networks.remove_reach(&reach.id)?;
        } else {
            reach.feature_id.clone_from(&previous_id);
            work.networks.put_reach(reach)?;
        }
    }
    if held {
        restore_network(work, source, &previous_id)?;
    }
    Ok(())
}
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(v)) => *v,
        Some(Value::String(v)) => !v.is_empty(),
        Some(Value::Number(v)) => v.as_f64().is_some_and(|v| v != 0.0),
        _ => true,
    }
}
fn group(feature: &Feature) -> String {
    let text = |key| match feature.attributes.get(key) {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(v)) => v.clone(),
        Some(v) => v.to_string(),
    };
    format!(
        "{}:{}:{}:{}",
        feature.kind,
        feature.layer_id,
        text("system"),
        text("rule")
    )
}
fn is_line(feature: &Feature) -> bool {
    matches!(
        feature.geometry,
        Geometry::LineString { .. } | Geometry::MultiLineString { .. }
    )
}
fn line_points(shape: &Geometry) -> Vec<Position> {
    match shape {
        Geometry::LineString { coordinates } => coordinates.clone(),
        Geometry::MultiLineString { coordinates } => {
            coordinates.iter().flatten().copied().collect()
        }
        _ => Vec::new(),
    }
}
fn line_corresponds(
    a: &Feature,
    b: &Feature,
    tolerance: f64,
    spatial: &dyn SpatialKernel,
) -> io::Result<bool> {
    let first = line_points(&a.geometry);
    let second = line_points(&b.geometry);
    for (a, b) in [
        (first.first(), second.first()),
        (first.last(), second.last()),
    ] {
        let (Some(a), Some(b)) = (a, b) else {
            return Ok(false);
        };
        let (a, b) = (a.coordinates(), b.coordinates());
        if (a[0] - b[0]).hypot(a[1] - b[1]) > tolerance {
            return Ok(false);
        }
    }
    for (points, other) in [(&first, b), (&second, a)] {
        for &point in points.iter().step_by((points.len() / 8).max(1)) {
            if spatial
                .distance(&other.geometry, &Geometry::Point { coordinates: point })
                .map_err(io::Error::other)?
                > tolerance
            {
                return Ok(false);
            }
        }
    }
    Ok(true)
}
struct Candidate {
    feature: Feature,
    bounds: Bounds,
    group: String,
}
fn similarity(
    feature: &Feature,
    candidate: &Candidate,
    tolerance: f64,
    spatial: &dyn SpatialKernel,
) -> io::Result<f64> {
    let a = spatial
        .bounds(&feature.geometry)
        .map_err(io::Error::other)?;
    let b = candidate.bounds;
    let gap = (b.0 - a.2)
        .max(a.0 - b.2)
        .max(b.1 - a.3)
        .max(a.1 - b.3)
        .max(0.0);
    if gap > tolerance || is_line(feature) != is_line(&candidate.feature) {
        return Ok(f64::INFINITY);
    }
    if is_line(&candidate.feature)
        && !line_corresponds(feature, &candidate.feature, tolerance, spatial)?
    {
        return Ok(f64::INFINITY);
    }
    let size = tolerance
        .max((a.2 - a.0).hypot(a.3 - a.1))
        .max((b.2 - b.0).hypot(b.3 - b.1));
    let distance = ((a.0 + a.2 - b.0 - b.2) / 2.0).hypot((a.1 + a.3 - b.1 - b.3) / 2.0);
    Ok((distance
        + ((a.0 - b.0).abs() + (a.1 - b.1).abs() + (a.2 - b.2).abs() + (a.3 - b.3).abs()) / 4.0)
        / size)
}
pub fn revisions(features: &dyn FeatureWorkspace) -> io::Result<BTreeMap<String, u64>> {
    features.revisions()?.collect()
}
pub fn changed(
    features: &dyn FeatureWorkspace,
    before: &BTreeMap<String, u64>,
) -> io::Result<Vec<String>> {
    features
        .revisions()?
        .filter_map(|result| match result {
            Ok((id, revision)) if before.get(&id) == Some(&revision) => None,
            Ok((id, _)) => Some(Ok(id)),
            Err(error) => Some(Err(error)),
        })
        .collect()
}
fn previous_candidates(
    source: &Original<'_>,
    area: &str,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Candidate>> {
    let mut candidates = Vec::new();
    for feature in source.features.values(FeatureSelection {
        area_id: Some(area),
        ..Default::default()
    })? {
        let feature = feature?;
        if truthy(feature.attributes.get("causeId"))
            || !matches!(
                feature
                    .attributes
                    .get("sourceAlgorithm")
                    .and_then(Value::as_str),
                Some("atlas-1" | "atlas-ecology-1")
            )
        {
            continue;
        }
        candidates.push(Candidate {
            bounds: spatial
                .bounds(&feature.geometry)
                .map_err(io::Error::other)?,
            group: group(&feature),
            feature,
        });
    }
    Ok(candidates)
}
fn ranked_features<'a>(
    work: &Working<'_>,
    source: &Original<'_>,
    generated: &'a [String],
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<(&'a String, f64)>> {
    let mut ranked = Vec::new();
    for id in generated {
        if let Some(feature) = work.features.get(id)? {
            if !truthy(feature.attributes.get("causeId")) && source.features.get(id)?.is_none() {
                ranked.push((
                    id,
                    spatial
                        .length(&feature.geometry)
                        .map_err(io::Error::other)?,
                ));
            }
        }
    }
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    Ok(ranked)
}
pub fn retain(
    work: &mut Working<'_>,
    source: &Original<'_>,
    area: &str,
    tolerance: f64,
    generated: &[String],
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    let candidates = previous_candidates(source, area, spatial)?;
    let mut used = BTreeSet::new();
    for id in generated {
        if let (Some(previous), Some(next)) = (source.features.get(id)?, work.features.get(id)?) {
            used.insert(id.clone());
            reuse(work, source, next, previous)?;
        }
    }
    if candidates.is_empty() {
        return Ok(());
    }
    let geometries = candidates
        .iter()
        .map(|c| c.feature.geometry.clone())
        .collect::<Vec<_>>();
    let index = spatial.index(&geometries).map_err(io::Error::other)?;
    for (id, _) in ranked_features(work, source, generated, spatial)? {
        let Some(feature) = work.features.get(id)? else {
            continue;
        };
        let b = spatial
            .bounds(&feature.geometry)
            .map_err(io::Error::other)?;
        let mut matches = index
            .query(Bounds(
                b.0 - tolerance,
                b.1 - tolerance,
                b.2 + tolerance,
                b.3 + tolerance,
            ))
            .map_err(io::Error::other)?;
        matches.sort_unstable();
        let group = group(&feature);
        let (mut best, mut score) = (None, 0.35);
        for at in matches {
            let candidate = &candidates[at];
            if used.contains(&candidate.feature.id) || candidate.group != group {
                continue;
            }
            let current = similarity(&feature, candidate, tolerance, spatial)?;
            if current < score {
                best = Some(at);
                score = current;
            }
        }
        if let Some(at) = best {
            let previous = candidates[at].feature.clone();
            used.insert(previous.id.clone());
            reuse(work, source, feature, previous)?;
        }
    }
    Ok(())
}
