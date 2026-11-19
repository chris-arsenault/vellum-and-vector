//! Open a building's floors: a structure map made from the building's published record on a
//! real-scale ground map (ADR 0016). Its only generated content is the shell (outer walls on
//! each level, the street door); it needs no numerical generation, so the host that owns the
//! map catalogue builds it directly and publishes it as a child of the ground map. The
//! browser workspace and the LAN service share this path.
use atlas_generation::atlas::resolution::HexSize;
use atlas_gis::{
    map_files::MapFiles,
    map_store::{FeatureQuery, MapAccess, Page},
};
use atlas_map::{
    authoring::family,
    structure::{shell, HexChoice, ShellRequest},
    MapDescriptor, MapFeature, MapRef, PublicationBatch, PublicationState, PublishedAsset,
    Publisher, RealScaleKind,
};
use serde::Deserialize;
use serde_json::json;
use std::io;

/// The structure-map call carried beside the authoring calls.
#[derive(Deserialize)]
#[serde(tag = "method", content = "args", rename_all = "camelCase")]
pub enum StructureCall {
    /// Open (or find) the floors map of a building on a real-scale ground map.
    OpenFloors(MapRef, atlas_map::Id),
}
impl StructureCall {
    /// The call when a request is one, else `None` so authoring calls go their own way.
    pub fn parse(request: &str) -> Option<Self> {
        serde_json::from_str(request).ok()
    }
    pub fn parse_value(value: serde_json::Value) -> Option<Self> {
        serde_json::from_value(value).ok()
    }
    pub fn reference(&self) -> &MapRef {
        match self {
            Self::OpenFloors(reference, _) => reference,
        }
    }
    pub fn execute<S: MapAccess + Publisher + ?Sized>(
        self,
        store: &mut S,
        files: &MapFiles,
    ) -> io::Result<MapRef> {
        match self {
            Self::OpenFloors(parent, building) => open_floors(store, files, &parent, building),
        }
    }
}

fn all<S: MapAccess + ?Sized>(
    store: &S,
    reference: &MapRef,
    mut query: FeatureQuery,
) -> io::Result<Vec<MapFeature>> {
    let mut items = Vec::new();
    loop {
        let Page { items: page, next } = store.features(reference, &query)?;
        items.extend(page);
        if next.is_none() {
            return Ok(items);
        }
        query.cursor = next;
    }
}
/// A fresh random identity. Structure maps open in the browser too, where the private input
/// store's helper is not compiled.
fn random() -> atlas_map::Id {
    atlas_map::Id::from_bytes(*uuid::Uuid::new_v4().as_bytes())
}
fn feature<S: MapAccess + ?Sized>(
    store: &S,
    map: &MapDescriptor,
    id: atlas_map::Id,
) -> io::Result<Option<MapFeature>> {
    for space in &map.spaces {
        let query = FeatureQuery {
            space_id: space.id,
            feature_ids: Some(vec![id]),
            ..Default::default()
        };
        if let Some(found) = all(store, &map.reference, query)?.pop() {
            return Ok(Some(found));
        }
    }
    Ok(None)
}
/// The floors map already opened for this building, if any.
fn existing<S: MapAccess + ?Sized>(
    store: &S,
    parent: &MapRef,
    building: atlas_map::Id,
) -> io::Result<Option<MapRef>> {
    for child in store.related(parent)?.children {
        let map = store.open(&child)?;
        let site = map.real_scale.as_ref().and_then(|real| real.site.as_ref());
        if site.is_some_and(|site| site.building_id == building) {
            return Ok(Some(child));
        }
    }
    Ok(None)
}
pub fn open_floors<S: MapAccess + Publisher + ?Sized>(
    store: &mut S,
    files: &MapFiles,
    parent: &MapRef,
    building_id: atlas_map::Id,
) -> io::Result<MapRef> {
    let map = store.open(parent)?;
    if map.real_scale.as_ref().map(|real| real.kind) != Some(RealScaleKind::Ground)
        || map.state != PublicationState::Complete
    {
        return Err(io::Error::other(
            "Floors open from a building on a finished real-scale ground map",
        ));
    }
    if let Some(found) = existing(store, parent, building_id)? {
        return Ok(found);
    }
    let building = feature(store, &map, building_id)?
        .filter(|f| family(&f.layer_id) == "structures" && f.kind == "building")
        .ok_or_else(|| io::Error::other("Choose a building on this map to open its floors"))?;
    let street = match building.relations.iter().find(|r| r.kind == "fronts") {
        Some(relation) => feature(store, &map, relation.target_id)?,
        None => None,
    };
    // The ladder size floors open at, from the structure vocabulary.
    let hex: HexSize =
        serde_json::from_value(json!(atlas_map::structure::vocabulary().shell.hex_size))?;
    let id = random();
    let reference = MapRef {
        map_id: id,
        revision: random(),
    };
    let request = ShellRequest {
        parent: &map,
        building: &building,
        street: street.as_ref(),
        reference: reference.clone(),
        hex: HexChoice {
            label: hex.label().into(),
            across_flats: hex.across_flats(),
            feet: hex.feet(),
        },
        asset_id: format!("{id}:shell"),
    };
    let precision = map
        .spaces
        .iter()
        .find(|space| space.id == building.space_id)
        .map_or(1e-6, |space| space.precision);
    let built = {
        let spatial = store.geometry().spatial(precision)?;
        shell(&request, spatial.as_ref()).map_err(io::Error::other)?
    };
    let asset = write_asset(files, &request.asset_id, &built.features)?;
    store.begin(&built.map, None, false)?;
    let published = store
        .append(
            &reference,
            PublicationBatch {
                features: built.features,
                assets: vec![asset],
                ..Default::default()
            },
        )
        .and_then(|()| store.finish(&reference));
    if let Err(error) = published {
        store.discard(&reference)?;
        return Err(error);
    }
    Ok(reference)
}
/// The shell as one GeoJSON asset, which every layer of the new map names.
fn write_asset(files: &MapFiles, id: &str, features: &[MapFeature]) -> io::Result<PublishedAsset> {
    let collection = json!({
        "type": "FeatureCollection",
        "features": features.iter().map(|f| json!({
            "type": "Feature",
            "id": f.id,
            "geometry": f.geometry,
            "properties": {"name": f.name, "kind": f.kind, "layerId": f.layer_id, "spaceId": f.space_id},
        })).collect::<Vec<_>>(),
    });
    let bytes = serde_json::to_vec(&collection)?;
    let location = format!("{}.geojson", uuid::Uuid::new_v4());
    files.ensure_directory()?;
    std::fs::write(files.path(&location)?, &bytes)?;
    Ok(PublishedAsset {
        id: id.into(),
        media_type: "application/geo+json".into(),
        location,
        byte_length: bytes.len() as u64,
        illustration: false,
    })
}
