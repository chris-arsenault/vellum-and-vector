//! Hexes take their play marks from the shapes over them; an edit re-marks every hex the
//! changed shapes covered before or cover now, from all the shapes over those hexes.
use super::{other, EditStore};
use crate::map_store::FeatureQuery;
use atlas_map::{
    authoring::{editable, Draft},
    hexes::{fill, mark_of, mark_shape, marks, Hex, MarkSource},
    spatial::SpatialKernel,
    Bounds, MapDescriptor, MapFeature,
};
use serde_json::{json, Value};
// hpc-exempt: hex records keyed by id while gathering a handful of hexes around one edit.
use std::collections::{BTreeMap, BTreeSet};
use std::io;

pub(super) fn remarked(
    store: &dyn EditStore,
    map: &MapDescriptor,
    draft: &Draft,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<MapFeature>> {
    let Some(layer) = map.layers.iter().find(|layer| layer.id == "vector:hexes") else {
        return Ok(Vec::new());
    };
    let grid = editable(map).map_err(other)?.grid().map_err(other)?;
    let mut hexes = BTreeMap::new();
    for (shape, _) in draft
        .before
        .iter()
        .chain(&draft.after)
        .filter_map(mark_shape)
    {
        let query = FeatureQuery {
            bounds: Some(spatial.bounds(&shape).map_err(other)?),
            layer_ids: Some(vec![layer.id.clone()]),
            ..Default::default()
        };
        for hex in store.all(map, query)? {
            hexes.insert(hex.id.clone(), hex);
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
    let changed: BTreeSet<&str> = draft
        .before
        .iter()
        .chain(&draft.after)
        .map(|feature| feature.id.as_str())
        .collect();
    let around = store.all(
        map,
        FeatureQuery {
            bounds: Some(area),
            layer_ids: Some(
                map.layers
                    .iter()
                    .filter(|layer| mark_of(&layer.id).is_some())
                    .map(|layer| layer.id.clone())
                    .collect(),
            ),
            footprints: true,
            ..Default::default()
        },
    )?;
    let shapes: Vec<_> = around
        .iter()
        .filter(|feature| !changed.contains(feature.id.as_str()))
        .chain(&draft.after)
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
