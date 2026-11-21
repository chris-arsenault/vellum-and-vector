//! Authored maps (ADR 0019): a world, region or city map a creator starts as open ocean and
//! draws by hand. It is published like any finished map, with no numerical generation state:
//! the profile's vector layers (every catalogue kind placeable), one terrain raster and an
//! editing block whose kind is `Authored`. The browser workspace and the LAN service share
//! this path, as they share structure maps.
use crate::authored_terrain::{TerrainEdit, TerrainHistory, TerrainOutcome, LAND_LAYER};
use atlas_generation::{
    atlas::resolution::Profile,
    publication::{
        authored::Terrain,
        catalogue::{presets, style, Catalogue, Layer},
        layers,
        raster::RasterGrid,
    },
};
use atlas_gis::{
    authoring::EditStore, map_files::MapFiles, map_protocol::EditingCall, map_store::MapAccess,
};
use atlas_map::{
    authoring::{shape_of, Shape},
    Bounds, CreatorLayer, GeometryType, LayerCatalog, LayerSource, MapDescriptor, MapFrame,
    MapLayer, MapProperty, MapRef, MapSpace, Position, PropertyType, PublicationBatch,
    PublicationState, PublishedAsset, RealScale, RealScaleKind, RegionGeometry, RegionScale,
    VectorSource,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};
use ts_rs::TS;

/// Which level of the atlas a new map is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AuthoredProfile {
    World,
    Region,
    City,
}
impl AuthoredProfile {
    fn layers(self) -> Profile {
        match self {
            Self::World => Profile::World,
            Self::Region => Profile::Region,
            Self::City => Profile::Local,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::World => "world",
            Self::Region => "region",
            Self::City => "local",
        }
    }
    /// Default frame in metres.
    fn frame(self) -> (f64, f64) {
        match self {
            Self::World => (6_000_000.0, 3_000_000.0),
            Self::Region => (600_000.0, 400_000.0),
            Self::City => (6_000.0, 4_000.0),
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewMapRequest {
    pub name: String,
    pub profile: AuthoredProfile,
    /// Frame in metres; the profile's default when absent.
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
}
/// The calls that make and shape authored maps, carried beside the authoring calls.
#[derive(Deserialize)]
#[serde(tag = "method", content = "args", rename_all = "camelCase")]
pub enum AuthoredCall {
    NewMap((NewMapRequest,)),
    Terrain(MapRef, TerrainEdit),
    UndoTerrain((MapRef,)),
    RedoTerrain((MapRef,)),
}
#[derive(Serialize)]
#[serde(untagged)]
pub enum AuthoredResult {
    Map(MapRef),
    Terrain(TerrainOutcome),
}
impl AuthoredCall {
    pub fn parse(request: &str) -> Option<Self> {
        serde_json::from_str(request).ok()
    }
    pub fn parse_value(value: serde_json::Value) -> Option<Self> {
        serde_json::from_value(value).ok()
    }
    /// The map the call acts on; a new map has none to check.
    pub fn reference(&self) -> Option<&MapRef> {
        match self {
            Self::NewMap(_) => None,
            Self::Terrain(r, _) | Self::UndoTerrain((r,)) | Self::RedoTerrain((r,)) => Some(r),
        }
    }
    pub fn execute<S: MapAccess + ?Sized>(
        self,
        store: &mut S,
        files: &MapFiles,
        history: &TerrainHistory,
    ) -> io::Result<AuthoredResult> {
        Ok(match self {
            Self::NewMap((request,)) => AuthoredResult::Map(new_map(store, files, &request)?),
            Self::Terrain(r, edit) => {
                AuthoredResult::Terrain(history.edit(&*store, files, &r, &edit)?)
            }
            Self::UndoTerrain((r,)) => {
                AuthoredResult::Terrain(history.step(&*store, files, &r, false)?)
            }
            Self::RedoTerrain((r,)) => {
                AuthoredResult::Terrain(history.step(&*store, files, &r, true)?)
            }
        })
    }
}

fn random() -> atlas_map::Id {
    atlas_map::Id::from_bytes(*uuid::Uuid::new_v4().as_bytes())
}
fn other(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}
/// The layers an authored map offers: the profile's vector layers, plus landmasses.
fn vocabulary(profile: AuthoredProfile) -> BTreeMap<String, Layer> {
    let mut all = layers::builtin();
    all.insert(
        "landmasses".into(),
        Layer {
            id: "landmasses".into(),
            name: "Landmasses".into(),
            family: "physical".into(),
            color: "#c8b88a".into(),
            representation: "vector".into(),
            representations: Some(vec!["vector".into()]),
            profiles: vec![Profile::World, Profile::Region, Profile::Local],
            generator: None,
            facts: None,
            schema: BTreeMap::new(),
        },
    );
    all.retain(|id, layer| {
        layer.profiles.contains(&profile.layers())
            && layer.vector()
            && !layers::underground(id)
            && id != "hexes"
    });
    all
}
/// The shape a new feature of a kind is drawn as, which the editor offers first.
fn suggested(layer: &str, kind: &str) -> Vec<GeometryType> {
    match shape_of(layer) {
        Some(Shape::Line) => return vec![GeometryType::LineString],
        Some(Shape::Area) => return vec![GeometryType::Polygon],
        None => {}
    }
    match (layer, kind) {
        (
            "geology",
            "range" | "ridge" | "valley" | "gorge" | "escarpment" | "cliff" | "strait" | "fjord"
            | "pass",
        ) => vec![GeometryType::LineString],
        ("geology", "plateau" | "hill" | "bay" | "moraine" | "caldera" | "crater" | "dome") => {
            vec![GeometryType::Polygon]
        }
        _ => vec![GeometryType::Point],
    }
}
fn catalogue_of(layer: &Layer, all: &BTreeMap<String, Layer>) -> LayerCatalog {
    let catalogue = Catalogue {
        layers: all,
        systems: &[],
        confluences: &[],
    };
    let mut feature_types: Vec<_> = catalogue.available(&layer.id).into_values().collect();
    for kind in &mut feature_types {
        kind.geometries = suggested(&layer.id, &kind.kind);
    }
    feature_types.sort_by_key(|kind| kind.path.join(" / "));
    let mut properties = BTreeMap::new();
    for key in ["name", "kind"] {
        properties.insert(
            key.into(),
            MapProperty {
                kind: PropertyType::String,
            },
        );
    }
    let mut default_style = style(layer);
    default_style.visible = true;
    LayerCatalog {
        path: vec![layer.name.clone()],
        common: true,
        feature_types,
        default_style: Some(default_style),
        presets: presets(layer),
        properties,
        examples: Vec::new(),
        geometries: Vec::new(),
    }
}
fn descriptor(
    request: &NewMapRequest,
    reference: &MapRef,
    bounds: Bounds,
    precision: f64,
) -> MapDescriptor {
    let space = reference.map_id;
    let Bounds(w, s, e, n) = bounds;
    MapDescriptor {
        reference: reference.clone(),
        world_id: random(),
        name: request.name.trim().to_string(),
        primary_space_id: space,
        profile: request.profile.name().into(),
        region_scale: RegionScale {
            level: 0,
            next_area: (e - w) * (n - s) / 7.0,
            subdivision: 7.0,
            minimum_width: precision,
            enabled: false,
        },
        footprint: RegionGeometry::Polygon(vec![vec![
            Position::xy(w, s),
            Position::xy(e, s),
            Position::xy(e, n),
            Position::xy(w, n),
            Position::xy(w, s),
        ]]),
        bounds,
        spaces: vec![MapSpace {
            id: space,
            bounds,
            parent_space_id: None,
            metres_per_unit: 1.0,
            precision,
            periodic_width: None,
            frame: MapFrame {
                origin: [0.0, 0.0, 0.0],
                rotation: 0.0,
                floor: None,
            },
        }],
        parent: None,
        state: PublicationState::Incomplete,
        layers: Vec::new(),
        real_scale: Some(RealScale {
            kind: RealScaleKind::Authored,
            hex_size: String::new(),
            // Snapping tolerance is a hundredth of this: ten times the map's precision.
            across_flats: precision * 1000.0,
            feet: 0.0,
            origin: [(w + e) / 2.0, (s + n) / 2.0],
            triangles_per_edge: 1,
            creator_layers: vec![CreatorLayer::base()],
            edits: 0,
            site: None,
            authoring: Default::default(),
        }),
    }
}
/// Publish a blank map: open ocean, every vector layer of its level empty.
pub fn new_map<S: MapAccess + ?Sized>(
    store: &mut S,
    files: &MapFiles,
    request: &NewMapRequest,
) -> io::Result<MapRef> {
    if request.name.trim().is_empty() {
        return Err(other("Name the map"));
    }
    let (width, height) = request.profile.frame();
    let (width, height) = (
        request.width.unwrap_or(width),
        request.height.unwrap_or(height),
    );
    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
        return Err(other("A map needs a width and height above zero"));
    }
    let bounds = Bounds(0.0, 0.0, width, height);
    let reference = MapRef {
        map_id: random(),
        revision: random(),
    };
    let mut map = descriptor(
        request,
        &reference,
        bounds,
        (width.max(height) / 1e9).max(1e-6),
    );
    let vocabulary = vocabulary(request.profile);
    let features = shared_asset(files, &reference)?;
    for layer in vocabulary.values() {
        map.layers.push(MapLayer {
            id: format!("vector:{}", layer.id),
            name: layer.name.clone(),
            space_id: map.primary_space_id,
            bounds,
            attribution: Vec::new(),
            catalog: catalogue_of(layer, &vocabulary),
            source: LayerSource::Vector(VectorSource {
                asset_id: features.id.clone(),
                media_type: "application/geo+json".into(),
            }),
        });
    }
    let columns = 1024u32;
    let rows = ((f64::from(columns) * height / width).round() as u32).clamp(64, 4096);
    let terrain = Terrain::ocean(RasterGrid {
        width: columns,
        height: rows,
        bounds,
    })?;
    store.begin(&map, None, false)?;
    let published = publish(store, files, &reference, &map, features, &terrain);
    if let Err(error) = published {
        store.discard(&reference)?;
        return Err(error);
    }
    Ok(reference)
}
fn publish<S: MapAccess + ?Sized>(
    store: &mut S,
    files: &MapFiles,
    reference: &MapRef,
    map: &MapDescriptor,
    features: PublishedAsset,
    terrain: &Terrain,
) -> io::Result<()> {
    store.append(
        reference,
        PublicationBatch {
            assets: vec![features],
            ..Default::default()
        },
    )?;
    let id = format!("{}:terrain", reference.map_id);
    let mut encoded = terrain.encode()?;
    encoded.source.asset_id = id.clone();
    let location = format!("{}.tiff", uuid::Uuid::new_v4());
    files.ensure_directory()?;
    std::fs::write(files.path(&location)?, &encoded.bytes)?;
    let asset = PublishedAsset {
        id,
        media_type: "image/tiff".into(),
        location,
        byte_length: encoded.bytes.len() as u64,
        illustration: false,
    };
    let layer = MapLayer {
        id: crate::authored_terrain::TERRAIN_LAYER.into(),
        name: "Elevation".into(),
        space_id: map.primary_space_id,
        bounds: terrain.grid.bounds,
        attribution: Vec::new(),
        catalog: LayerCatalog {
            path: vec!["Terrain".into()],
            common: true,
            feature_types: Vec::new(),
            default_style: None,
            presets: Vec::new(),
            properties: BTreeMap::new(),
            examples: Vec::new(),
            geometries: Vec::new(),
        },
        source: LayerSource::Raster(encoded.source),
    };
    store.add_layers(reference, std::slice::from_ref(&layer), asset)?;
    store.finish(reference)
}
/// An empty feature collection that every vector layer of the new map names.
fn shared_asset(files: &MapFiles, reference: &MapRef) -> io::Result<PublishedAsset> {
    let bytes =
        serde_json::to_vec(&serde_json::json!({"type": "FeatureCollection", "features": []}))?;
    let location = format!("{}.geojson", uuid::Uuid::new_v4());
    files.ensure_directory()?;
    std::fs::write(files.path(&location)?, &bytes)?;
    Ok(PublishedAsset {
        id: format!("{}:authored", reference.map_id),
        media_type: "application/geo+json".into(),
        location,
        byte_length: bytes.len() as u64,
        illustration: false,
    })
}

/// Run an authoring call. On an authored map, a change to a landmass, or any undo or redo,
/// conforms the terrain to the coasts afterwards: coasts decide land and sea.
pub fn edit(
    call: EditingCall,
    store: &dyn EditStore,
    files: &MapFiles,
    names: &dyn atlas_gis::authoring::TownNames,
    history: &TerrainHistory,
) -> io::Result<Vec<u8>> {
    let reference = call.reference().clone();
    let touches = authored(store, &reference)? && moves_land(store, &reference, &call)?;
    let bytes = call.execute(store, files, names)?;
    if touches {
        crate::authored_terrain::reconform(store, files, history, &reference)?;
    }
    Ok(bytes)
}
fn authored<S: MapAccess + ?Sized>(store: &S, reference: &MapRef) -> io::Result<bool> {
    Ok(store
        .open(reference)?
        .real_scale
        .is_some_and(|real| real.kind == RealScaleKind::Authored))
}
fn moves_land<S: MapAccess + ?Sized>(
    store: &S,
    reference: &MapRef,
    call: &EditingCall,
) -> io::Result<bool> {
    use atlas_map::authoring::EditCommand::*;
    let ids = match call {
        EditingCall::Undo(_) | EditingCall::Redo(_) => return Ok(true),
        EditingCall::History(_) => return Ok(false),
        EditingCall::Edit(_, command) => match command {
            Create { layer_id, .. } => return Ok(layer_id == LAND_LAYER),
            Reshape { id, .. } => vec![*id],
            Transform { ids, .. }
            | Duplicate { ids, .. }
            | Delete { ids }
            | MoveToLayer { ids, .. } => ids.clone(),
            _ => return Ok(false),
        },
    };
    let map = store.open(reference)?;
    let query = atlas_gis::map_store::FeatureQuery {
        space_id: map.primary_space_id,
        feature_ids: Some(ids),
        layer_ids: Some(vec![LAND_LAYER.into()]),
        ..Default::default()
    };
    Ok(!store.features(reference, &query)?.items.is_empty())
}
