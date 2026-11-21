#![cfg(not(target_arch = "wasm32"))]
//! An authored map starts as open ocean, takes landmasses and places by the ordinary edit
//! commands, and has its terrain conformed to its coasts and sculpted with undo (ADR 0019).
use atlas_generation::publication::{authored::Terrain, raster::RasterGrid};
use atlas_gis::{
    authoring::NoNames, map_files::MapFiles, map_protocol::EditingCall, map_store::MapStore,
    sql::Database,
};
use atlas_host::{
    authored_maps::{edit, new_map, AuthoredCall, AuthoredProfile, AuthoredResult, NewMapRequest},
    authored_terrain::TerrainHistory,
};
use atlas_map::{LayerSource, MapRef, RealScaleKind};
use serde_json::json;
use std::{path::PathBuf, rc::Rc};

fn temporary(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("atlas-authored-{name}-{}", uuid::Uuid::new_v4()))
}
fn blank() -> (MapStore, MapRef, MapFiles) {
    let mut store =
        MapStore::open_database(Rc::new(Database::open(temporary("maps")).unwrap())).unwrap();
    let files = MapFiles::new(temporary("assets"));
    let request = NewMapRequest {
        name: "Test world".into(),
        profile: AuthoredProfile::World,
        width: Some(1000.0),
        height: Some(500.0),
    };
    let reference = new_map(&mut store, &files, &request).unwrap();
    (store, reference, files)
}
fn call(store: &MapStore, files: &MapFiles, history: &TerrainHistory, value: serde_json::Value) {
    let call: EditingCall = serde_json::from_value(value).unwrap();
    edit(call, store.edits(), files, &NoNames, history).unwrap();
}
fn terrain(store: &MapStore, files: &MapFiles, reference: &MapRef) -> Terrain {
    let map = store.access().open(reference).unwrap();
    let layer = map.layers.iter().find(|l| l.id == "terrain").unwrap();
    let LayerSource::Raster(source) = &layer.source else {
        panic!("terrain is a raster")
    };
    let location = store
        .access()
        .asset(reference, &source.asset_id)
        .unwrap()
        .location;
    let grid = RasterGrid {
        width: source.width,
        height: source.height,
        bounds: layer.bounds,
    };
    Terrain::decode(grid, &files.read(&location).unwrap()).unwrap()
}
fn height_at(terrain: &Terrain, x: f64, y: f64) -> f32 {
    let (col, row) = terrain.cell_at(x, y).unwrap();
    terrain.heights()[row as usize * terrain.grid.width as usize + col as usize]
}
fn island(reference: &MapRef) -> serde_json::Value {
    json!({"method":"edit","args":[reference,{"command":"create","layerId":"vector:landmasses",
        "kind":"landmass","name":"Isle",
        "geometry":{"type":"Polygon","coordinates":[[[300,150],[700,150],[700,350],[300,350],[300,150]]]},
        "attributes":{},"creatorLayer":null}]})
}

#[test]
fn a_blank_map_is_open_ocean_with_every_level_layer_and_a_terrain_raster() {
    let (store, reference, files) = blank();
    let map = store.access().open(&reference).unwrap();
    assert_eq!(map.real_scale.unwrap().kind, RealScaleKind::Authored);
    let LayerSource::Raster(source) = &map
        .layers
        .iter()
        .find(|l| l.id == "terrain")
        .unwrap()
        .source
    else {
        panic!("terrain is a raster")
    };
    assert_eq!(source.bands.len(), 16);
    let land = map
        .layers
        .iter()
        .find(|l| l.id == "vector:landmasses")
        .unwrap();
    assert!(land
        .catalog
        .feature_types
        .iter()
        .any(|kind| kind.kind == "landmass"));
    assert!(map.layers.iter().any(|l| l.id == "vector:geology"));
    let ocean = terrain(&store, &files, &reference);
    assert!(ocean.heights().iter().all(|h| *h < 0.0));
}
#[test]
fn a_drawn_landmass_raises_land_and_a_peak_can_be_placed_anywhere() {
    let (store, reference, files) = blank();
    let history = TerrainHistory::default();
    call(&store, &files, &history, island(&reference));
    let drawn = terrain(&store, &files, &reference);
    assert!(height_at(&drawn, 500.0, 250.0) > 0.0);
    assert!(height_at(&drawn, 50.0, 50.0) < 0.0);
    call(
        &store,
        &files,
        &history,
        json!({"method":"edit","args":[&reference,{"command":"create","layerId":"vector:geology",
            "kind":"peak","name":"Mount Test","geometry":{"type":"Point","coordinates":[500,250]},
            "attributes":{},"creatorLayer":null}]}),
    );
}
#[test]
fn a_city_map_takes_streets_and_buildings() {
    let mut store =
        MapStore::open_database(Rc::new(Database::open(temporary("maps")).unwrap())).unwrap();
    let files = MapFiles::new(temporary("assets"));
    let request = NewMapRequest {
        name: "Test city".into(),
        profile: AuthoredProfile::City,
        width: None,
        height: None,
    };
    let reference = new_map(&mut store, &files, &request).unwrap();
    let history = TerrainHistory::default();
    call(
        &store,
        &files,
        &history,
        json!({"method":"edit","args":[&reference,{"command":"drawStreet","roadClass":"street",
            "geometry":{"type":"LineString","coordinates":[[500,500],[900,500]]},
            "name":"Mill Lane","creatorLayer":null}]}),
    );
    call(
        &store,
        &files,
        &history,
        json!({"method":"edit","args":[&reference,{"command":"placeBuilding","buildingUse":"house",
            "at":[700,520],"name":"Number One","creatorLayer":null}]}),
    );
    let map = store.access().open(&reference).unwrap();
    assert!(map.layers.iter().any(|l| l.id == "vector:plots"));
}
#[test]
fn terrain_strokes_follow_the_coast_and_undo() {
    let (store, reference, files) = blank();
    let history = TerrainHistory::default();
    call(&store, &files, &history, island(&reference));
    let stroke = json!({"method":"terrain","args":[&reference,{"type":"stroke","value":{
        "points":[[500.0,250.0]],"radius":60.0,"strength":1.0,"mode":"raise",
        "target":0.0,"stepHeight":400.0}}]});
    let before = height_at(&terrain(&store, &files, &reference), 500.0, 250.0);
    let AuthoredResult::Terrain(done) = AuthoredCall::parse_value(stroke)
        .unwrap()
        .execute(&mut store.clone(), &files, &history)
        .unwrap()
    else {
        panic!("a terrain outcome")
    };
    assert!(done.can_undo);
    let raised = height_at(&terrain(&store, &files, &reference), 500.0, 250.0);
    assert!(raised > before + 100.0);
    let undo =
        AuthoredCall::parse_value(json!({"method":"undoTerrain","args":[&reference]})).unwrap();
    undo.execute(&mut store.clone(), &files, &history).unwrap();
    assert_eq!(
        height_at(&terrain(&store, &files, &reference), 500.0, 250.0),
        before
    );
    let redo =
        AuthoredCall::parse_value(json!({"method":"redoTerrain","args":[&reference]})).unwrap();
    redo.execute(&mut store.clone(), &files, &history).unwrap();
    assert_eq!(
        height_at(&terrain(&store, &files, &reference), 500.0, 250.0),
        raised
    );
    // Raising ocean outside the coast is held below sea level.
    let sea = json!({"method":"terrain","args":[&reference,{"type":"stroke","value":{
        "points":[[100.0,100.0]],"radius":60.0,"strength":1.0,"mode":"raise",
        "target":0.0,"stepHeight":9000.0}}]});
    AuthoredCall::parse_value(sea)
        .unwrap()
        .execute(&mut store.clone(), &files, &history)
        .unwrap();
    assert!(height_at(&terrain(&store, &files, &reference), 100.0, 100.0) < 0.0);
}
