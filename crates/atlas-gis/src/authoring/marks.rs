//! Hexes take their play marks from the shapes over them; an edit re-marks every hex the
//! changed shapes covered before or cover now, from all the shapes over those hexes.
use super::{other, EditStore};
use crate::map_store::FeatureQuery;
use atlas_map::{
    authoring::{editable, is_hex_layer, Draft},
    hexes::{fill, mark_of, mark_shape, marks, Hex, MarkSource},
    spatial::SpatialKernel,
    Bounds, MapDescriptor, MapFeature,
};
use serde_json::{json, Value};
// hpc-exempt: hex records keyed by id while gathering a handful of hexes around one edit.
use std::collections::{BTreeMap, BTreeSet};
use std::io;

/// Each located space keeps its own hex grid (the surface, the caves, each level of a
/// building), so a changed shape re-marks the hexes of its own space only. A space the
/// change removes, or whose hexes it removes, has nothing left to re-mark.
pub(super) fn remarked(
    store: &dyn EditStore,
    map: &MapDescriptor,
    draft: &Draft,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<MapFeature>> {
    let spaces: BTreeSet<atlas_map::Id> = draft
        .before
        .iter()
        .chain(&draft.after)
        .filter(|feature| mark_of(&feature.layer_id).is_some())
        .map(|feature| feature.space_id)
        .collect();
    // The layers as they stand after the change: a step that opens or closes a space (and
    // its replay by undo or redo) brings its own layout.
    let layers = draft
        .spaces
        .as_ref()
        .map_or(&map.layers, |layout| &layout.layers);
    let mut all = Vec::new();
    for space in spaces {
        let layer = layers
            .iter()
            .find(|layer| layer.space_id == space && is_hex_layer(&layer.id));
        if let Some(layer) = layer {
            all.extend(remarked_in(store, map, layers, draft, layer, spatial)?);
        }
    }
    Ok(all)
}
fn remarked_in(
    store: &dyn EditStore,
    map: &MapDescriptor,
    layers: &[atlas_map::MapLayer],
    draft: &Draft,
    layer: &atlas_map::MapLayer,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<MapFeature>> {
    let space = layer.space_id;
    let grid = editable(map).map_err(other)?.grid().map_err(other)?;
    let removed =
        |id| draft.before.iter().any(|f| f.id == id) && !draft.after.iter().any(|f| f.id == id);
    let mut hexes = BTreeMap::new();
    for (shape, _) in draft
        .before
        .iter()
        .chain(&draft.after)
        .filter(|feature| feature.space_id == space)
        .filter_map(mark_shape)
    {
        let reach = spatial.bounds(&shape).map_err(other)?;
        let query = FeatureQuery {
            space_id: space,
            bounds: Some(reach),
            layer_ids: Some(vec![layer.id.clone()]),
            ..Default::default()
        };
        for hex in store.all(map, query)? {
            if !removed(hex.id) {
                hexes.insert(hex.id, hex);
            }
        }
        // Hexes the change creates, such as the grid of an underground space a first cave
        // wall opens, are not stored yet and are marked with the shapes drawn over them.
        for hex in draft.after.iter().filter(|hex| hex.layer_id == layer.id) {
            if overlaps(spatial.bounds(&hex.geometry).map_err(other)?, reach) {
                hexes.insert(hex.id, hex.clone());
            }
        }
    }
    let mut hexes: Vec<MapFeature> = hexes.into_values().collect();
    let Some(area) = covered(&hexes, spatial)? else {
        return Ok(Vec::new());
    };
    let addresses = hexes
        .iter()
        .map(address)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| io::Error::other("A published hex has no address"))?;
    let changed: BTreeSet<atlas_map::Id> = draft
        .before
        .iter()
        .chain(&draft.after)
        .map(|feature| feature.id)
        .collect();
    let around = store.all(
        map,
        FeatureQuery {
            space_id: space,
            bounds: Some(area),
            layer_ids: Some(
                layers
                    .iter()
                    .filter(|layer| layer.space_id == space && mark_of(&layer.id).is_some())
                    .map(|layer| layer.id.clone())
                    .collect(),
            ),
            footprints: true,
            ..Default::default()
        },
    )?;
    let shapes: Vec<_> = around
        .iter()
        .filter(|feature| !changed.contains(&feature.id))
        .chain(
            draft
                .after
                .iter()
                .filter(|feature| feature.space_id == space),
        )
        .filter_map(mark_shape)
        .collect();
    let sources: Vec<_> = shapes
        .iter()
        .map(|(geometry, mark)| MarkSource { geometry, mark })
        .collect();
    let marked = marks(&grid, &addresses, &sources, spatial).map_err(other)?;
    for (hex, marks) in hexes.iter_mut().zip(marked) {
        let main = fill(&marks).map_or(Value::Null, Into::into);
        hex.attributes.insert("fill".into(), main);
        hex.attributes.insert("marks".into(), json!(marks));
    }
    Ok(hexes)
}
fn address(hex: &MapFeature) -> Option<Hex> {
    let read = |key: &str| {
        hex.attributes
            .get(key)?
            .as_i64()
            .and_then(|v| i32::try_from(v).ok())
    };
    Some(Hex {
        q: read("q")?,
        r: read("r")?,
    })
}
fn overlaps(Bounds(w, s, e, n): Bounds, Bounds(bw, bs, be, bn): Bounds) -> bool {
    w <= be && bw <= e && s <= bn && bs <= n
}
fn covered(hexes: &[MapFeature], spatial: &dyn SpatialKernel) -> io::Result<Option<Bounds>> {
    let mut area: Option<Bounds> = None;
    for hex in hexes {
        let Bounds(w, s, e, n) = spatial.bounds(&hex.geometry).map_err(other)?;
        area = Some(match area {
            Some(Bounds(aw, as_, ae, an)) => Bounds(aw.min(w), as_.min(s), ae.max(e), an.max(n)),
            None => Bounds(w, s, e, n),
        });
    }
    Ok(area)
}
