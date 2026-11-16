//! A real-scale map's hex layer: one polygon per hex holding the play marks its shapes leave
//! (ADR 0016). Marks are recomputed from published shapes, never from private generation data.
use crate::features::{Feature, State};
use atlas_map::{
    hexes::{marks, Hex, HexGrid, MarkSource},
    spatial::SpatialKernel,
    Bounds, Geometry, RealScale,
};
use serde_json::{json, Map, Value};
// hpc-exempt: a hex's marks are a few named shares, not cell-indexed numerical storage.
use std::{collections::BTreeMap, io};

// Publication and editing share one set of mark rules, held with the hex contract.
pub use atlas_map::hexes::{fill, mark_shape};
/// The map's own surface, read once per hex: the class covering most of the hex's triangles.
pub struct Ground<'a> {
    pub resource: &'a crate::field::inheritance::resources::Resource,
    pub channel: &'a str,
    pub labels: &'a [atlas_map::Category],
}
/// The surface class covering most of each hex, as its published label.
pub fn ground_classes(
    grid: &HexGrid,
    hexes: &[Hex],
    ground: &Ground<'_>,
) -> io::Result<Vec<Option<String>>> {
    let Some(channel) = ground.resource.channels.get(ground.channel) else {
        return Ok(vec![None; hexes.len()]);
    };
    let values = channel.values.read_values()?;
    // hpc-exempt: hex addresses of the map's few thousand hexes, not cell-indexed storage.
    let index: BTreeMap<Hex, usize> = hexes.iter().enumerate().map(|(i, h)| (*h, i)).collect();
    // hpc-exempt: a few surface classes per hex.
    let mut counts: Vec<BTreeMap<i64, usize>> = vec![BTreeMap::new(); hexes.len()];
    let active = &ground.resource.active;
    for cell in 0..active.len() {
        if active.get(cell)? == 0 {
            continue;
        }
        if let Some(&i) = index.get(&grid.hex_at(ground.resource.grid.position(cell)?)) {
            *counts[i].entry(values.get(cell)? as i64).or_default() += 1;
        }
    }
    Ok(counts
        .into_iter()
        .map(|classes| {
            let (class, _) = classes.into_iter().max_by_key(|(_, count)| *count)?;
            let label = ground.labels.iter().find(|c| i64::from(c.value) == class);
            Some(label.map_or_else(|| class.to_string(), |c| c.label.clone()))
        })
        .collect())
}
pub fn hex_features(
    real: &RealScale,
    frame: Bounds,
    area: &str,
    sources: &[(Geometry, &'static str)],
    ground: Option<&Ground<'_>>,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Feature>> {
    let grid = real.grid().map_err(io::Error::other)?;
    let hexes = grid.covering(frame);
    let sources: Vec<_> = sources
        .iter()
        .map(|(geometry, mark)| MarkSource { geometry, mark })
        .collect();
    let marked = marks(&grid, &hexes, &sources, spatial).map_err(io::Error::other)?;
    let grounds = match ground {
        Some(ground) => ground_classes(&grid, &hexes, ground)?,
        None => vec![None; hexes.len()],
    };
    Ok(hexes
        .into_iter()
        .zip(marked)
        .zip(grounds)
        .map(|((hex, marks), ground)| {
            let mut attributes = Map::new();
            attributes.insert("q".into(), hex.q.into());
            attributes.insert("r".into(), hex.r.into());
            attributes.insert("fill".into(), fill(&marks).map_or(Value::Null, Into::into));
            attributes.insert("marks".into(), json!(marks));
            attributes.insert("ground".into(), ground.map_or(Value::Null, Into::into));
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
