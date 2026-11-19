use atlas_gis::validate_map;
use atlas_map::{Id, MapDescriptor, MapErrorCode, MapRef, MapValidation};
use serde_json::{json, Value};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

/// A fixture's identity from its name.
fn id(name: &str) -> Id {
    Id::from_name(name)
}
fn supplied_map() -> Value {
    json!({
        "reference": {"mapId":id("islands"), "revision":id("published-1")},
        "worldId":id("world"), "name":"Islands", "parent":null, "state":"complete",
        "primarySpaceId":id("surface"),
        "profile":"world",
        "regionScale":{"level":0,"nextArea":2500,"subdivision":7,"minimumWidth":0.001,"enabled":true},
        "footprint":{"type":"Polygon","coordinates":[[[-30,40],[70,40],[70,140],[-30,140],[-30,40]]]},
        "bounds":[-30,40,70,140],
        "spaces":[{"id":id("surface"), "parentSpaceId":null, "bounds":[-30,40,70,140], "metresPerUnit":1, "precision":0.000001, "periodicWidth":null,
            "frame":{"origin":[0,0,0],"rotation":0,"floor":null}}],
        "layers":[{"id":"terrain", "spaceId":id("surface"), "name":"Terrain", "bounds":[-30,40,70,140], "attribution":[],
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
        map_id: id("islands"),
        revision: id("published-1"),
    };
    let changed = MapRef {
        revision: id("published-2"),
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
fn deleting_parent_keeps_independent_child_and_lists_incomplete_revisions() {
    use atlas_gis::{map_store::MapStore, sql::Database};
    use atlas_map::{PublicationState, Publisher};
    let mut store =
        MapStore::open_database(std::rc::Rc::new(Database::open(":memory:").unwrap())).unwrap();
    let mut parent: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    parent.layers.clear();
    parent.state = PublicationState::Incomplete;
    store.begin(&parent, None, false).unwrap();
    store.finish(&parent.reference).unwrap();
    let mut child = parent.clone();
    child.reference.map_id = id("child");
    child.parent = Some(parent.reference.clone());
    store.begin(&child, None, false).unwrap();
    store.finish(&child.reference).unwrap();
    let mut incomplete = parent.clone();
    incomplete.reference.map_id = id("unfinished");
    store.begin(&incomplete, None, false).unwrap();
    assert_eq!(
        store
            .inventory()
            .unwrap()
            .iter()
            .filter(|m| !m.complete)
            .count(),
        1
    );
    store.delete_map(parent.reference.map_id).unwrap();
    assert!(store
        .open(&child.reference)
        .unwrap()
        .require_complete()
        .is_ok());
    assert_eq!(
        store.related(&child.reference).unwrap().parent,
        Some(parent.reference)
    );
    store.delete_map(id("islands")).unwrap(); // Metadata cleanup is safe to retry.
    assert_eq!(store.inventory().unwrap().len(), 2);
}

#[test]
fn unreadable_saved_map_stays_listed_and_does_not_hide_other_maps() {
    use atlas_gis::{
        map_store::{MapStore, SaveRequest},
        sql::Database,
    };
    use atlas_map::{PublicationState, Publisher};
    use std::rc::Rc;
    let db = Rc::new(Database::open(":memory:").unwrap());
    let mut store = MapStore::open_database(db.clone()).unwrap();
    let mut map: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    map.layers.clear();
    map.state = PublicationState::Incomplete;
    store.begin(&map, None, false).unwrap();
    store.finish(&map.reference).unwrap();
    store
        .save(
            SaveRequest {
                reference: map.reference.clone(),
                expected_version: None,
                navigation: Default::default(),
                settings: Default::default(),
            },
            "today".into(),
        )
        .unwrap();
    assert!(store.find_saved(id("islands")).unwrap().is_some());
    // Settings no current reader understands make the map unreadable, not invisible.
    db.execute("UPDATE maps SET real_scale=?", &["{\"kind\":3}".into()])
        .unwrap();
    assert!(store.find_saved(id("islands")).is_err());
    let listed = store.list_saved(None).unwrap();
    assert_eq!(listed.items[0].reference, map.reference);
    assert!(listed.items[0].problem.is_some());
    assert!(db
        .value("SELECT real_scale FROM maps", &[])
        .unwrap()
        .is_some());
}

#[test]
fn publication_retry_keeps_one_identity_and_preserves_completed_maps() {
    use atlas_gis::{map_store::MapStore, sql::Database};
    use atlas_map::{PublicationState, Publisher};
    let mut store =
        MapStore::open_database(std::rc::Rc::new(Database::open(":memory:").unwrap())).unwrap();
    let mut map: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    map.layers.clear();
    map.state = PublicationState::Incomplete;
    store.begin(&map, None, true).unwrap();
    store.restart_publication(&map.reference).unwrap();
    store.begin(&map, None, true).unwrap();
    store.finish(&map.reference).unwrap();
    assert_eq!(store.inventory().unwrap().len(), 1);
    assert!(store.restart_publication(&map.reference).is_err());
    assert!(store
        .open(&map.reference)
        .unwrap()
        .require_complete()
        .is_ok());
}

#[test]
fn discarding_a_stream_restores_the_replaced_head_and_a_new_map_keeps_its_output() {
    use atlas_gis::{map_store::MapStore, sql::Database};
    use atlas_map::{PublicationState, Publisher};
    let mut store =
        MapStore::open_database(std::rc::Rc::new(Database::open(":memory:").unwrap())).unwrap();
    let mut captured: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    captured.layers.clear();
    captured.state = PublicationState::Incomplete;
    store.begin(&captured, None, true).unwrap();
    store.finish(&captured.reference).unwrap();
    let mut refined = captured.clone();
    refined.reference.revision = id("refined");
    store
        .begin(&refined, Some(&captured.reference), true)
        .unwrap();
    store.discard(&refined.reference).unwrap();
    assert_eq!(
        store.find_head(captured.reference.map_id).unwrap(),
        Some(captured.reference.clone())
    );
    assert!(store.open(&refined.reference).is_err());
    let mut fresh = captured.clone();
    fresh.reference.map_id = id("fresh");
    store.begin(&fresh, None, true).unwrap();
    store.discard(&fresh.reference).unwrap();
    assert_eq!(
        store.find_head(id("fresh")).unwrap(),
        Some(fresh.reference.clone())
    );
}

#[test]
fn progressive_revision_replaces_its_expected_head_and_atomic_waits_for_finish() {
    use atlas_gis::{map_store::MapStore, sql::Database};
    use atlas_map::{PublicationState, Publisher};
    let mut store =
        MapStore::open_database(std::rc::Rc::new(Database::open(":memory:").unwrap())).unwrap();
    let mut captured: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    captured.layers.clear();
    captured.state = PublicationState::Incomplete;
    store.begin(&captured, None, true).unwrap();
    store.finish(&captured.reference).unwrap();
    let mut refined = captured.clone();
    refined.reference.revision = id("refined");
    store
        .begin(&refined, Some(&captured.reference), true)
        .unwrap();
    assert_eq!(
        store.find_head(captured.reference.map_id).unwrap(),
        Some(refined.reference.clone())
    );
    // An interrupted stream restarts from the head it replaced.
    store.restart_publication(&refined.reference).unwrap();
    assert_eq!(
        store.find_head(captured.reference.map_id).unwrap(),
        Some(captured.reference.clone())
    );
    store
        .begin(&refined, Some(&captured.reference), true)
        .unwrap();
    store.finish(&refined.reference).unwrap();
    let mut regenerated = captured.clone();
    regenerated.reference.revision = id("regenerated");
    store
        .begin(&regenerated, Some(&refined.reference), false)
        .unwrap();
    assert_eq!(
        store.find_head(captured.reference.map_id).unwrap(),
        Some(refined.reference.clone())
    );
    store.finish(&regenerated.reference).unwrap();
    assert_eq!(
        store.find_head(captured.reference.map_id).unwrap(),
        Some(regenerated.reference)
    );
}

#[test]
fn deleting_child_detaches_saved_selection_without_deleting_its_shape() {
    use atlas_gis::{
        map_store::{MapStore, SaveRequest},
        sql::Database,
    };
    use atlas_map::{PublicationState, Publisher};
    let mut store =
        MapStore::open_database(std::rc::Rc::new(Database::open(":memory:").unwrap())).unwrap();
    let mut parent: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    parent.layers.clear();
    parent.state = PublicationState::Incomplete;
    store.begin(&parent, None, false).unwrap();
    store.finish(&parent.reference).unwrap();
    let mut child = parent.clone();
    child.reference.map_id = id("child");
    child.parent = Some(parent.reference.clone());
    store.begin(&child, None, false).unwrap();
    store.finish(&child.reference).unwrap();
    let shape = json!({"type":"Polygon","coordinates":[[[0,60],[30,60],[30,90],[0,90],[0,60]]]});
    let navigation = serde_json::from_value(json!({
        "version":1, "regions":[{
            "id":"selection", "name":"Child region", "spaceId":id("surface"),
            "parentId":null, "geometry":shape, "child":child.reference
        }], "views":[]
    }))
    .unwrap();
    store
        .save(
            SaveRequest {
                reference: parent.reference.clone(),
                expected_version: None,
                navigation,
                settings: Default::default(),
            },
            "today".into(),
        )
        .unwrap();
    store.delete_map(id("child")).unwrap();
    let saved = store.find_saved(id("islands")).unwrap().unwrap();
    assert_eq!(saved.navigation.regions.len(), 1);
    assert_eq!(
        saved.navigation.regions[0].geometry,
        serde_json::from_value(shape).unwrap()
    );
    assert!(saved.navigation.regions[0].child.is_none());
    assert_eq!(saved.navigation.version, 2);
}

/// An undrawn raster layer is published with its asset, and a copied map keeps its samples.
#[test]
fn attribute_layers_publish_and_copied_maps_keep_their_samples() {
    use atlas_gis::{map_store::MapStore, sql::Database};
    use atlas_map::{LayerSource, PublicationState, PublishedAsset, Publisher};
    use std::rc::Rc;
    let directory = std::env::temp_dir().join(format!("atlas-copy-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let (source, target) = (
        directory.join("source.sqlite"),
        directory.join("target.sqlite"),
    );
    let mut map: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    let mut layer = map.layers.remove(0);
    map.state = PublicationState::Incomplete;
    let LayerSource::Raster(raster) = layer.source else {
        unreachable!()
    };
    layer.id = "raster:magicApplied:aurora".into();
    layer.source = LayerSource::Attributes(raster);
    {
        let mut store = MapStore::open_database(Rc::new(Database::open(&source).unwrap())).unwrap();
        store.begin(&map, None, false).unwrap();
        let asset = PublishedAsset {
            id: "map-terrain".into(),
            media_type: "image/tiff".into(),
            location: "terrain.tif".into(),
            byte_length: 10,
            illustration: false,
        };
        store
            .add_layers(&map.reference, std::slice::from_ref(&layer), asset)
            .unwrap();
        let sample = json!({"id":"0:cell:0","spaceId":id("surface"),"footprint":map.footprint,
            "window":{"bounds":[-30,40,70,140],"closedEast":true,"closedNorth":true},
            "cellSpan":100,"center":[20,90,0],"measure":10000,"active":true,"sections":[]});
        store
            .append(
                &map.reference,
                serde_json::from_value(json!({ "samples": [sample] })).unwrap(),
            )
            .unwrap();
        store.finish(&map.reference).unwrap();
    }
    let store = MapStore::open_database(Rc::new(Database::open(&target).unwrap())).unwrap();
    store
        .copy_from(&source.to_string_lossy(), &map.reference)
        .unwrap();
    let copied = store.open(&map.reference).unwrap();
    assert!(matches!(
        copied.layers[0].source,
        LayerSource::Attributes(_)
    ));
    let found = store
        .samples_at(
            &map.reference,
            id("surface"),
            atlas_map::Position::xy(20.0, 90.0),
        )
        .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].center, atlas_map::Position::XYZ([20.0, 90.0, 0.0]));
    drop(store);
    std::fs::remove_dir_all(directory).unwrap();
}

/// History reads back in the order it was published, across a page, whatever order its
/// identities sort in.
#[test]
fn history_keeps_its_published_order_across_pages() {
    use atlas_gis::{map_store::MapStore, sql::Database};
    use atlas_map::{PublicationState, Publisher};
    let mut store =
        MapStore::open_database(std::rc::Rc::new(Database::open(":memory:").unwrap())).unwrap();
    let mut map: MapDescriptor = serde_json::from_value(supplied_map()).unwrap();
    map.layers.clear();
    map.state = PublicationState::Incomplete;
    store.begin(&map, None, false).unwrap();
    let entries: Vec<Value> = (0..300)
        .map(|i| {
            json!({"id":id(&format!("entry {i}")),"title":format!("Entry {i}"),
                "description":"","epoch":null,"featureIds":[],"attributes":{}})
        })
        .collect();
    store
        .append(
            &map.reference,
            serde_json::from_value(json!({ "history": entries })).unwrap(),
        )
        .unwrap();
    store.finish(&map.reference).unwrap();
    let first = store.history(&map.reference, None, None).unwrap();
    let rest = store.history(&map.reference, first.next, None).unwrap();
    let titles: Vec<String> = first
        .items
        .iter()
        .chain(&rest.items)
        .map(|entry| entry.title.clone())
        .collect();
    let published: Vec<String> = (0..300).map(|i| format!("Entry {i}")).collect();
    assert_eq!(titles, published);
    assert!(rest.next.is_none());
}

/// The registry lists the columns of the values its features hold, from the map's column
/// rows: a column first sent as text and later as a number is numeric.
#[test]
fn registry_columns_are_rows_of_the_map() {
    use atlas_gis::{
        map_store::{MapStore, RegistryRequest, Scope, Sort},
        sql::Database,
    };
    use atlas_map::{MapColumn, PublicationState, Publisher};
    let mut store =
        MapStore::open_database(std::rc::Rc::new(Database::open(":memory:").unwrap())).unwrap();
    let mut value = supplied_map();
    value["layers"] = json!([{"id":"places","name":"Places","spaceId":id("surface"),
        "bounds":[-30,40,70,140],"attribution":[],
        "catalog":{"path":["Places"],"common":true,"featureTypes":[{"id":"place","kind":"place",
            "label":"Places","path":["Places"],"magicDepiction":null,"count":0,"geometries":[],
            "footprints":false}],"defaultStyle":null,"presets":[],"properties":{},"examples":[],
            "geometries":[]},
        "source":{"kind":"vector","data":{"assetId":"places","mediaType":"application/geo+json"}}}]);
    let mut map: MapDescriptor = serde_json::from_value(value).unwrap();
    map.state = PublicationState::Incomplete;
    store.begin(&map, None, false).unwrap();
    let feature = |name: &str, values: Value| {
        json!({"id":id(name),"name":name,"spaceId":id("surface"),"layerId":"places",
            "typeId":"place","kind":"place","entityId":null,
            "geometry":{"type":"Point","coordinates":[0,60]},"footprint":null,"attributes":{},
            "relations":[],"causes":[],
            "catalog":{"values":values,"origin":"Generated geography","mapOnly":false}})
    };
    let column = |key: &str, label: &str, numeric: bool| MapColumn {
        key: key.into(),
        label: label.into(),
        numeric,
    };
    let mut first: atlas_map::PublicationBatch = serde_json::from_value(json!({
        "features":[feature("mill",json!({"name":"Mill","people":"few"}))]
    }))
    .unwrap();
    first.columns = vec![
        column("name", "Name", false),
        column("people", "People", false),
    ];
    store.append(&map.reference, first).unwrap();
    let mut second: atlas_map::PublicationBatch = serde_json::from_value(json!({
        "features":[feature("forge",json!({"name":"Forge","people":12}))]
    }))
    .unwrap();
    second.columns = vec![column("people", "People", true)];
    store.append(&map.reference, second).unwrap();
    store.append(&map.reference, assets_for("places")).unwrap();
    store.finish(&map.reference).unwrap();
    let page = store
        .access()
        .registry(
            &map.reference,
            &RegistryRequest {
                scope: Scope::Map,
                bounds: None,
                query: Default::default(),
                sort: Sort {
                    key: "name".into(),
                    descending: false,
                },
                page: 0,
                limit: 10,
            },
        )
        .unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(
        page.columns,
        [
            column("name", "Name", false),
            column("people", "People", true)
        ]
    );
}
fn assets_for(id: &str) -> atlas_map::PublicationBatch {
    serde_json::from_value(json!({"assets":[{"id":id,"location":"places.geojson",
        "mediaType":"application/geo+json","byteLength":100,"illustration":false}]}))
    .unwrap()
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
    let bytes = ReadCall::Geometries(map.reference.clone(), id("surface"), queries)
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
