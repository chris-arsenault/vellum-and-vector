//! Cave walls: drawing the first one opens the map's underground space, and every wall reads
//! the rock and magic it cuts from the map's published samples (ADR 0016), never from private
//! generation resources.
use super::{other, EditStore};
use crate::map_store::FeatureQuery;
use atlas_map::{
    authoring::{context::wall_context, Draft, EditCommand},
    spatial::SpatialKernel,
    underground::{opened, CAVE_WALLS},
    Bounds, Geometry, MapDescriptor, MapFeature, MapSample, Position,
};
use serde_json::Value;
use std::{collections::BTreeSet, io};

/// Readings along a wall stand at most this far apart, in metres; where the published
/// samples are finer than that, at half a sample apart, so no sample along the wall is missed.
const READING_SPACING: f64 = 1.0;
/// How far from a wall, in hexes, a generated cave lends the wall its depth.
const CAVE_REACH_HEXES: f64 = 10.0;

/// The map a command plans against: a first cave wall opens the underground space, its wall
/// layer and its hex grid, copied from the surface hexes.
pub(super) fn opening(
    store: &dyn EditStore,
    map: MapDescriptor,
    command: &EditCommand,
) -> io::Result<(MapDescriptor, Vec<MapFeature>)> {
    let draws_wall =
        matches!(command, EditCommand::Create { layer_id, .. } if layer_id == CAVE_WALLS);
    if !draws_wall || map.layers.iter().any(|layer| layer.id == CAVE_WALLS) {
        return Ok((map, Vec::new()));
    }
    let surface = FeatureQuery {
        space_id: map.primary_space_id.clone(),
        layer_ids: Some(vec!["vector:hexes".into()]),
        ..Default::default()
    };
    let hexes = store.all(&map, surface)?;
    opened(&map, &hexes).map_err(other)
}
/// Every wall the change draws, moves or sets at a new depth records the rock it now cuts
/// and its special features.
pub(super) fn read_walls(
    store: &dyn EditStore,
    map: &MapDescriptor,
    draft: &mut Draft,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    for index in 0..draft.after.len() {
        let wall = &draft.after[index];
        let changed = draft
            .before
            .iter()
            .find(|old| old.id == wall.id)
            .is_none_or(|old| {
                old.geometry != wall.geometry
                    || old.attributes.get("depth") != wall.attributes.get("depth")
            });
        if wall.layer_id != CAVE_WALLS || !changed {
            continue;
        }
        let depth = wall_depth(store, map, wall, spatial)?;
        let samples = samples_along(store, map, &wall.geometry, spatial)?;
        let context = wall_context(map, &samples, depth);
        let wall = &mut draft.after[index];
        wall.attributes.extend(context.attributes());
        wall.attributes.insert(
            "cutDepth".into(),
            depth.map_or(Value::Null, |d| d.round().into()),
        );
    }
    Ok(())
}
/// The depth below the ground a wall stands at: its own `depth` when the creator set one,
/// else the depth of the nearest generated cave within reach; unknown otherwise.
fn wall_depth(
    store: &dyn EditStore,
    map: &MapDescriptor,
    wall: &MapFeature,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<f64>> {
    if let Some(depth) = wall.attributes.get("depth").and_then(Value::as_f64) {
        return Ok(Some(depth));
    }
    if !map.layers.iter().any(|layer| layer.id == "vector:caves") {
        return Ok(None);
    }
    let reach = map.real_scale.as_ref().map_or(1.0, |r| r.across_flats) * CAVE_REACH_HEXES;
    let Bounds(w, s, e, n) = spatial.bounds(&wall.geometry).map_err(other)?;
    let query = FeatureQuery {
        space_id: wall.space_id.clone(),
        bounds: Some(Bounds(w - reach, s - reach, e + reach, n + reach)),
        layer_ids: Some(vec!["vector:caves".into()]),
        ..Default::default()
    };
    let mut nearest: Option<(f64, f64)> = None;
    for cave in store.all(map, query)? {
        let Some(depth) = cave.attributes.get("depth").and_then(Value::as_f64) else {
            continue;
        };
        let gap = spatial
            .distance(&cave.geometry, &wall.geometry)
            .map_err(other)?;
        if gap <= reach && nearest.is_none_or(|(best, _)| gap < best) {
            nearest = Some((gap, depth));
        }
    }
    Ok(nearest.map(|(_, depth)| depth))
}
/// The published samples under a wall, read at its vertices and at points along it.
fn samples_along(
    store: &dyn EditStore,
    map: &MapDescriptor,
    wall: &Geometry,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<MapSample>> {
    let Geometry::LineString { coordinates } = wall else {
        return Ok(Vec::new());
    };
    let read = |point: Position| store.samples_at(&map.reference, &map.primary_space_id, point);
    let first = read(coordinates[0])?;
    let span = first
        .iter()
        .map(|sample| sample.cell_span / 2.0)
        .fold(READING_SPACING, f64::min)
        .max(1e-3);
    let length = spatial.length(wall).map_err(other)?;
    let count = (length / span).ceil().max(1.0) as usize;
    let mut points = coordinates[1..].to_vec();
    for k in 1..count {
        points.push(
            spatial
                .line_at(wall, k as f64 / count as f64)
                .map_err(other)?,
        );
    }
    let mut seen = BTreeSet::new();
    let mut samples = Vec::new();
    for sample in first {
        if seen.insert(sample.id.clone()) {
            samples.push(sample);
        }
    }
    for point in points {
        for sample in read(point)? {
            if seen.insert(sample.id.clone()) {
                samples.push(sample);
            }
        }
    }
    Ok(samples)
}
