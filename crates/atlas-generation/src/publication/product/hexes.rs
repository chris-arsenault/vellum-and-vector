//! A real-scale map's hex layer: one polygon per hex holding the play marks its shapes leave
//! (ADR 0016). Marks are recomputed from published shapes, never from private generation data.
use crate::features::{Feature, State};
use atlas_map::{
    hexes::{marks, MarkSource},
    spatial::SpatialKernel,
    Bounds, Geometry, MapFeature, RealScale,
};
use serde_json::{json, Map, Value};
// hpc-exempt: a hex's marks are a few named shares, not cell-indexed numerical storage.
use std::{collections::BTreeMap, io};

/// The play mark a published layer leaves on the hexes it covers or crosses.
pub fn mark_of(layer_id: &str) -> Option<&'static str> {
    match layer_id.strip_prefix("vector:").unwrap_or(layer_id) {
        "rivers" | "lakes" | "oceans" | "waterworks" => Some("water"),
        "roads" => Some("way"),
        "plots" => Some("plot"),
        "structures" | "ruins" => Some("structure"),
        "objects" => Some("object"),
        _ => None,
    }
}
/// The ground a published feature covers: its footprint when it has one, else its geometry.
pub fn mark_shape(feature: &MapFeature) -> Option<(Geometry, &'static str)> {
    let mark = mark_of(&feature.layer_id)?;
    let shape = feature
        .footprint
        .as_ref()
        .map(atlas_map::regions::as_geometry)
        .unwrap_or_else(|| feature.geometry.clone());
    Some((shape, mark))
}
/// The mark that covers most of a hex; areas outrank a line or point only when they cover more.
// hpc-exempt: a hex's marks are a few named shares, not cell-indexed numerical storage.
pub fn fill(marks: &BTreeMap<String, f64>) -> Option<&str> {
    marks
        .iter()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map(|(mark, _)| mark.as_str())
}
pub fn hex_features(
    real: &RealScale,
    frame: Bounds,
    area: &str,
    sources: &[(Geometry, &'static str)],
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Feature>> {
    let grid = real.grid().map_err(io::Error::other)?;
    let hexes = grid.covering(frame);
    let sources: Vec<_> = sources
        .iter()
        .map(|(geometry, mark)| MarkSource { geometry, mark })
        .collect();
    let marked = marks(&grid, &hexes, &sources, spatial).map_err(io::Error::other)?;
    Ok(hexes
        .into_iter()
        .zip(marked)
        .map(|(hex, marks)| {
            let mut attributes = Map::new();
            attributes.insert("q".into(), hex.q.into());
            attributes.insert("r".into(), hex.r.into());
            attributes.insert("fill".into(), fill(&marks).map_or(Value::Null, Into::into));
            attributes.insert("marks".into(), json!(marks));
            attributes.insert("nameStatus".into(), "label".into());
            Feature {
                map_only: None,
                place_id: None,
                footprint: None,
                id: format!("hex:{area}:{}:{}", hex.q, hex.r),
                name: format!("Hex {}, {}", hex.q, hex.r),
                kind: "hex".into(),
                layer_id: "hexes".into(),
                area_id: area.into(),
                geometry: grid.polygon(hex),
                detail: Default::default(),
                attributes,
                relations: Vec::new(),
                state: State::Generated,
                protected: false,
                actor: "publication".into(),
                generation_id: None,
                causes: Vec::new(),
                generation_domain: None,
            }
        })
        .collect())
}
