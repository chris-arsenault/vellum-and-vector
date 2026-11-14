use atlas_gis::validate_map;
use atlas_map::{MapDescriptor, MapErrorCode, MapRef, MapValidation};
use serde_json::{json, Value};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

fn supplied_map() -> Value {
    json!({
        "reference": {"mapId":"islands", "revision":"published-1"},
        "worldId":"world", "name":"Islands", "parent":null, "state":"complete",
        "primarySpaceId":"surface",
        "profile":"world",
        "regionScale":{"level":0,"nextArea":2500,"subdivision":7,"minimumWidth":0.001,"enabled":true},
        "footprint":{"type":"Polygon","coordinates":[[[-30,40],[70,40],[70,140],[-30,140],[-30,40]]]},
        "bounds":[-30,40,70,140],
        "spaces":[{"id":"surface", "parentSpaceId":null, "bounds":[-30,40,70,140], "metresPerUnit":1, "precision":0.000001, "periodicWidth":null,
            "frame":{"origin":[0,0,0],"rotation":0,"floor":null}}],
        "layers":[{"id":"terrain", "spaceId":"surface", "name":"Terrain", "bounds":[-30,40,70,140], "attribution":[],
            "catalog":{"path":["Terrain"],"common":true,"featureTypes":[],"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]},
            "source":{"kind":"raster", "data":{"assetId":"map-terrain", "mediaType":"image/tiff",
                "width":2,"height":2,"cellSpan":50,"overviews":[],"bandIndices":[1],
                "bands":[{"id":"height", "name":"Height", "unit":"metre", "display":{"unit":"m","factor":1}, "nodata":null, "categories":[], "range":[-5,30]}]}}}]
    })
}

fn validate(value: Value) -> MapValidation {
    serde_json::from_str(&validate_map(&value.to_string())).unwrap()
}

#[test]
fn published_descriptor_validates_without_any_generation_manifest() {
    let MapValidation::Valid(map) = validate(supplied_map()) else {
        panic!("Map must open")
    };
    assert!(map.require_complete().is_ok());
}

#[test]
fn current_map_contract_rejects_generation_escape_hatches() {
    let mut value = supplied_map();
    value["generationResource"] = json!("private-field");
    let MapValidation::Invalid(error) = validate(value) else {
        panic!("Unknown resource must fail")
    };
    assert_eq!(error.code, MapErrorCode::InvalidMap);
}

#[test]
fn invalid_rasters_and_duplicate_layers_fail_before_presentation() {
    let mut value = supplied_map();
    value["layers"][0]["source"]["data"]["width"] = json!(0);
    assert!(matches!(validate(value), MapValidation::Invalid(_)));
    let mut value = supplied_map();
    let layer = value["layers"][0].clone();
    value["layers"].as_array_mut().unwrap().push(layer);
    assert!(matches!(validate(value), MapValidation::Invalid(_)));
}

#[test]
fn incomplete_publication_cannot_be_saved_as_a_finished_map() {
    let mut value = supplied_map();
    value["state"] = json!("incomplete");
    let map: MapDescriptor = serde_json::from_value(value).unwrap();
    assert_eq!(
        map.require_complete().unwrap_err().code,
        MapErrorCode::IncompleteMap
    );
}

#[test]
fn selections_do_not_silently_resolve_a_different_parent_revision() {
    let captured = MapRef {
        map_id: "islands".into(),
        revision: "published-1".into(),
    };
    let changed = MapRef {
        revision: "published-2".into(),
        ..captured.clone()
    };
    assert_eq!(
        captured.require_revision(&changed).unwrap_err().code,
        MapErrorCode::RevisionConflict
    );
}

#[test]
fn malformed_input_returns_a_typed_failure() {
    let reply: MapValidation = serde_json::from_str(&validate_map("not json")).unwrap();
    assert!(matches!(reply, MapValidation::Invalid(_)));
}

#[test]
fn saved_gis_reads_and_spatial_queries_need_no_generator_or_private_store() {
    use atlas_gis::{
        map_files::MapFiles, map_protocol::ReadCall, map_store::MapStore, sql::Database,
    };
    use atlas_map::{GeometryQuery, GeometryResult, PublicationState, Publisher};
    use std::rc::Rc;
    let path = std::env::temp_dir().join(format!("atlas-gis-{}.sqlite", uuid::Uuid::new_v4()));
    let mut map: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    map.layers.clear();
    map.state = PublicationState::Incomplete;
    {
        let mut store = MapStore::open_database(Rc::new(Database::open(&path).unwrap())).unwrap();
        store.begin(&map, None, false).unwrap();
        store.finish(&map.reference).unwrap();
    }
    let store = MapStore::open_database(Rc::new(Database::open(&path).unwrap())).unwrap();
    let files = MapFiles::new(path.with_extension("absent-assets"));
    let bytes = ReadCall::Open((map.reference.clone(),))
        .execute(store.access(), &files)
        .unwrap();
    let opened: MapDescriptor = ciborium::from_reader(bytes.as_slice()).unwrap();
    assert_eq!(opened.state, PublicationState::Complete);
    let shape = atlas_map::regions::as_geometry(&map.footprint);
    let queries = vec![
        GeometryQuery::Interior {
            geometry: shape.clone(),
        },
        GeometryQuery::Covers {
            geometry: shape,
            points: vec![
                atlas_map::Position::xy(0.0, 50.0),
                atlas_map::Position::xy(1000.0, 50.0),
            ],
        },
    ];
    let bytes = ReadCall::Geometries(map.reference.clone(), "surface".into(), queries)
        .execute(store.access(), &files)
        .unwrap();
    let result: Vec<GeometryResult> = ciborium::from_reader(bytes.as_slice()).unwrap();
    assert!(matches!(&result[0], GeometryResult::Position(_)));
    assert!(matches!(&result[1], GeometryResult::Coverage(v) if v == &[true, false]));
    assert!(ReadCall::Export(map.reference, "geojson".into())
        .execute(store.access(), &files)
        .is_ok());
    drop(store);
    std::fs::remove_file(path).unwrap();
}
