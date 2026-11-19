//! Dissolve map sample boxes, then cut out the published ocean and lakes.
use crate::{
    atlas::state::State,
    features::FeatureSelection,
    field::geographic_contours,
    reconstruction::{Grid, Layout},
    spatial::{Overlay, Predicate},
};
use atlas_map::{regions::rectangle, Bounds, Geometry};
use std::io;

fn sample_box(grid: &Grid, sample: usize) -> io::Result<Bounds> {
    let [w, s, e, n] = grid.bounds;
    Ok(match &grid.layout {
        Layout::Adaptive(topology) => {
            let [w, s, e, n] = topology.cell(sample)?;
            Bounds(w, s, e, n)
        }
        Layout::Raster { width, height } => {
            let x = (sample % width) as f64;
            let y = (sample / width) as f64;
            let dx = (e - w) / (width - 1) as f64;
            let dy = (n - s) / (height - 1) as f64;
            Bounds(
                w.max(w + (x - 0.5) * dx),
                s.max(s + (y - 0.5) * dy),
                e.min(w + (x + 0.5) * dx),
                n.min(s + (y + 0.5) * dy),
            )
        }
    })
}
pub(super) fn samples(
    state: &State,
    belongs: impl Fn(usize) -> io::Result<bool>,
) -> io::Result<Option<Geometry>> {
    let grid = state.physical.surface.grid();
    // hpc-exempt: geometry boxes being dissolved, not numerical working-state storage.
    let mut boxes = Vec::new();
    for sample in 0..state.physical.active.len() {
        if belongs(sample)? {
            boxes.push(sample_box(grid, sample)?);
        }
    }
    // hpc-exempt: ordering geometric boxes by row and position for GEOS union.
    boxes.sort_by(|a, b| {
        a.1.total_cmp(&b.1)
            .then(a.3.total_cmp(&b.3))
            .then(a.0.total_cmp(&b.0))
    });
    let mut strips = Vec::new();
    let mut current: Option<Bounds> = None;
    for next in boxes {
        if let Some(bounds) = current.as_mut() {
            if bounds.1 == next.1 && bounds.3 == next.3 && (bounds.2 - next.0).abs() < 1e-6 {
                bounds.2 = next.2;
                continue;
            }
            strips.push(rectangle(*bounds));
        }
        current = Some(next);
    }
    if let Some(bounds) = current {
        strips.push(rectangle(bounds));
    }
    if strips.is_empty() {
        return Ok(None);
    }
    let union = state.spatial.union_all(&strips).map_err(io::Error::other)?;
    clip_water(state, union)
}
fn clip_water(state: &State, union: Option<Geometry>) -> io::Result<Option<Geometry>> {
    let mut shape = geographic_contours::clip(state, union)?;
    if let (Some(land), Some(ocean)) = (&shape, &state.physical.ocean) {
        shape = state
            .spatial
            .overlay(land, ocean, Overlay::Difference)
            .map_err(io::Error::other)?;
    }
    for lake in state.records.features.values(FeatureSelection {
        area_id: Some(state.scope.area),
        kind: Some("lake"),
        ..Default::default()
    })? {
        let lake = lake?;
        if let Some(land) = &shape {
            if state
                .spatial
                .relation(land, &lake.geometry, Predicate::Intersects)
                .map_err(io::Error::other)?
            {
                shape = state
                    .spatial
                    .overlay(land, &lake.geometry, Overlay::Difference)
                    .map_err(io::Error::other)?;
            }
        }
    }
    Ok(shape)
}
