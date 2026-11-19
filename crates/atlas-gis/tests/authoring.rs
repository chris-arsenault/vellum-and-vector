#![cfg(not(target_arch = "wasm32"))]
//! Authoring commands, junction topology, undo and save on a small supplied real-scale map.
use atlas_gis::{
    map_files::MapFiles,
    map_store::{FeatureQuery, MapStore, SaveRequest},
    sql::Database,
};
use atlas_map::{
    authoring::{EditCommand, Transform},
    hexes::{Hex, HexGrid},
    Geometry, Id, MapDescriptor, MapFeature, MapNavigationState, MapRef, PublicationBatch,
    Publisher,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io, path::PathBuf, rc::Rc};

/// A fixture's identity from its name.
fn id(name: &str) -> Id {
    Id::from_name(name)
}
/// The fixture map has no rasters.
fn files() -> MapFiles {
    MapFiles::new(std::env::temp_dir())
}
fn hex_id(hex: Hex) -> Id {
    hex.id(id("vector:hexes"))
}

const LAYERS: [(&str, &str, &[&str]); 5] = [
    ("rivers", "Rivers", &["stream"]),
    ("roads", "Roads", &["trail"]),
    ("structures", "Structures", &["bridge", "building"]),
    ("objects", "Objects", &["log"]),
    ("hexes", "Hexes", &["hex"]),
];

fn layer(id: &str, name: &str, kinds: &[&str]) -> Value {
    let types: Vec<Value> = kinds
        .iter()
        .map(|kind| json!({"id":kind,"kind":kind,"label":kind,"path":[name],"magicDepiction":null,"count":0,"geometries":[],"footprints":false}))
        .collect();
    json!({"id":format!("vector:{id}"),"name":name,"spaceId":self::id("surface"),"bounds":[0,0,30,20],"attribution":[],
        "catalog":{"path":[name],"common":true,"featureTypes":types,"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]},
        "source":{"kind":"vector","data":{"assetId":id,"mediaType":"application/geo+json"}}})
}
fn descriptor(name: &str, real_scale: bool) -> MapDescriptor {
    let layers: Vec<Value> = LAYERS
        .iter()
        .map(|(id, name, kinds)| layer(id, name, kinds))
        .collect();
    let mut value = json!({
        "reference":{"mapId":id(name),"revision":id("published")},"worldId":id("world"),"name":"Glen","parent":null,"state":"incomplete",
        "profile":"local","primarySpaceId":id("surface"),"bounds":[0,0,30,20],
        "footprint":{"type":"Polygon","coordinates":[[[0,0],[30,0],[30,20],[0,20],[0,0]]]},
        "regionScale":{"level":0,"nextArea":25,"subdivision":7,"minimumWidth":0.01,"enabled":!real_scale},
        "spaces":[{"id":id("surface"),"parentSpaceId":null,"bounds":[0,0,30,20],"metresPerUnit":1,"precision":0.000001,"periodicWidth":null,"frame":{"origin":[0,0,0],"rotation":0,"floor":null}}],
        "layers":layers
    });
    if real_scale {
        value["realScale"] = json!({"kind":"ground","hexSize":"1.5m","acrossFlats":1.5,"feet":5,"origin":[15,10],
            "trianglesPerEdge":2,"creatorLayers":[{"id":id("base"),"name":"Base layer"}],"edits":0});
    }
    serde_json::from_value(value).unwrap()
}
fn feature(name: &str, layer: &str, kind: &str, geometry: Value, attributes: Value) -> MapFeature {
    feature_with(id(name), name, layer, kind, geometry, attributes)
}
fn feature_with(
    identity: Id,
    name: &str,
    layer: &str,
    kind: &str,
    geometry: Value,
    attributes: Value,
) -> MapFeature {
    serde_json::from_value(json!({"id":identity,"name":name,"spaceId":id("surface"),"layerId":format!("vector:{layer}"),"typeId":kind,"kind":kind,
        "entityId":null,"geometry":geometry,"footprint":null,"attributes":attributes,"relations":[],"causes":[],
        "catalog":{"values":{},"origin":"Generated geography","mapOnly":false}}))
    .unwrap()
}
fn line(points: &[[f64; 2]]) -> Value {
    json!({"type":"LineString","coordinates":points})
}
fn square(cx: f64, cy: f64, half: f64) -> Value {
    json!({"type":"Polygon","coordinates":[[[cx-half,cy-half],[cx+half,cy-half],[cx+half,cy+half],[cx-half,cy+half],[cx-half,cy-half]]]})
}
fn hexes() -> Vec<MapFeature> {
    let grid = HexGrid::from_across_flats(1.5, [15.0, 10.0]).unwrap();
    grid.covering(atlas_map::Bounds(0.0, 0.0, 30.0, 20.0))
        .into_iter()
        .map(|hex| {
            let [x, y] = grid.centre(hex);
            let marks = if grid.hex_at([10.0, 10.5]) == hex { json!({"water":1.0}) } else { json!({}) };
            let mut feature = feature_with(hex_id(hex), "hex", "hexes", "hex",
                serde_json::to_value(grid.polygon(hex)).unwrap(),
                json!({"q":hex.q,"r":hex.r,"marks":marks,"fill":null,"nameStatus":"label","centre":[x,y]}));
            feature.name = None;
            feature
        })
        .collect()
}
fn temporary() -> PathBuf {
    std::env::temp_dir().join(format!("atlas-authoring-{}.sqlite", uuid::Uuid::new_v4()))
}
fn publish(path: &PathBuf, id: &str, real_scale: bool) -> io::Result<(MapStore, MapRef)> {
    publish_map(path, descriptor(id, real_scale))
}
fn publish_map(path: &PathBuf, map: MapDescriptor) -> io::Result<(MapStore, MapRef)> {
    let mut store = MapStore::open_database(Rc::new(Database::open(path)?))?;
    store.begin(&map, None, false)?;
    let mut features = vec![
        feature(
            "stream",
            "rivers",
            "stream",
            line(&[[0.0, 10.0], [10.0, 10.5], [20.0, 10.0], [30.0, 9.5]]),
            json!({"widths":[1.0,1.5,2.0,1.0]}),
        ),
        feature(
            "trail",
            "roads",
            "trail",
            line(&[[15.0, 0.0], [15.0, 20.0]]),
            json!({"widths":[1.6,1.6]}),
        ),
        feature(
            "log",
            "objects",
            "log",
            square(5.0, 4.0, 0.5),
            json!({"rotation":0}),
        ),
    ];
    features.extend(hexes());
    let assets = LAYERS
        .iter()
        .map(|(id, ..)| serde_json::from_value(json!({"id":id,"location":format!("{id}.geojson"),"mediaType":"application/geo+json","byteLength":10,"illustration":false})).unwrap())
        .collect();
    store.append(
        &map.reference,
        PublicationBatch {
            features,
            assets,
            ..Default::default()
        },
    )?;
    store.finish(&map.reference)?;
    Ok((store, map.reference))
}
fn read(store: &MapStore, reference: &MapRef, feature: Id) -> Option<MapFeature> {
    let query = FeatureQuery {
        space_id: id("surface"),
        feature_ids: Some(vec![feature]),
        ..Default::default()
    };
    store.features(reference, &query).unwrap().items.pop()
}
fn coordinates(feature: &MapFeature) -> Vec<[f64; 2]> {
    let Geometry::LineString { coordinates } = &feature.geometry else {
        panic!("expected a line")
    };
    coordinates
        .iter()
        .map(|p| {
            let [x, y, _] = p.coordinates();
            [x, y]
        })
        .collect()
}
fn centre(feature: &MapFeature) -> [f64; 2] {
    let Geometry::Polygon { coordinates } = &feature.geometry else {
        panic!("expected an outline")
    };
    let ring = &coordinates[0][..coordinates[0].len() - 1];
    let n = ring.len() as f64;
    let sum = ring.iter().fold([0.0, 0.0], |[x, y], p| {
        let [px, py, _] = p.coordinates();
        [x + px, y + py]
    });
    [sum[0] / n, sum[1] / n]
}
fn hex_marks(store: &MapStore, reference: &MapRef, at: [f64; 2]) -> BTreeMap<String, f64> {
    let grid = HexGrid::from_across_flats(1.5, [15.0, 10.0]).unwrap();
    let hex = grid.hex_at(at);
    let found = read(store, reference, hex_id(hex)).unwrap();
    serde_json::from_value(found.attributes["marks"].clone()).unwrap()
}
fn bridge(store: &MapStore, reference: &MapRef) -> Id {
    let outcome = store
        .edits()
        .edit(
            reference,
            &EditCommand::Create {
                layer_id: "vector:structures".into(),
                kind: "bridge".into(),
                name: Some("Burn bridge".into()),
                geometry: serde_json::from_value(square(15.0, 10.0, 1.0)).unwrap(),
                attributes: BTreeMap::new(),
                creator_layer: None,
            },
            &files(),
        )
        .unwrap();
    assert!(outcome.changed.contains(&outcome.created[0]));
    outcome.created[0]
}

fn drag_stream(
    store: &MapStore,
    reference: &MapRef,
) -> io::Result<atlas_map::authoring::EditOutcome> {
    let moved = line(&[[0.0, 10.0], [10.0, 13.0], [20.0, 12.0], [30.0, 9.5]]);
    store.edits().edit(
        reference,
        &EditCommand::Reshape {
            id: id("stream"),
            geometry: serde_json::from_value(moved).unwrap(),
        },
        &files(),
    )
}
fn bridge_at(store: &MapStore, reference: &MapRef, feature: Id, [ex, ey]: [f64; 2]) {
    let [x, y] = centre(&read(store, reference, feature).unwrap());
    assert!(
        (x - ex).abs() < 1e-6 && (y - ey).abs() < 1e-6,
        "the bridge sits at {x}, {y}"
    );
}

#[test]
fn dragging_a_river_vertex_keeps_one_feature_its_widths_and_its_bridge() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    let bridge_id = bridge(&store, &reference);
    let created = read(&store, &reference, bridge_id).unwrap();
    let mut kinds: Vec<_> = created
        .relations
        .iter()
        .map(|r| (r.kind.as_str(), r.target_id))
        .collect();
    kinds.sort();
    assert_eq!(kinds, [("carries", id("trail")), ("spans", id("stream"))]);
    let outcome = drag_stream(&store, &reference)?;
    assert!(outcome.map.real_scale.as_ref().unwrap().authored());
    assert_eq!(
        outcome.history.steps.last().unwrap().label,
        "Reshape stream"
    );
    let stream = read(&store, &reference, id("stream")).unwrap();
    assert_eq!(coordinates(&stream)[1], [10.0, 13.0]);
    assert_eq!(stream.attributes["widths"], json!([1.0, 1.5, 2.0, 1.0]));
    assert!(
        stream.footprint.is_some(),
        "the widened line covers its ground"
    );
    // Where the moved burn now meets the trail.
    bridge_at(&store, &reference, bridge_id, [15.0, 12.5]);
    assert!(hex_marks(&store, &reference, [10.0, 13.0]).contains_key("water"));
    assert!(!hex_marks(&store, &reference, [10.0, 10.5]).contains_key("water"));
    std::fs::remove_file(path)
}

#[test]
fn undo_and_redo_write_each_side_of_a_step() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    let bridge_id = bridge(&store, &reference);
    drag_stream(&store, &reference)?;
    store.edits().undo(&reference)?;
    let stream = read(&store, &reference, id("stream")).unwrap();
    assert_eq!(coordinates(&stream)[1], [10.0, 10.5]);
    bridge_at(&store, &reference, bridge_id, [15.0, 10.0]);
    let history = store.edits().edit_history(&reference)?;
    assert_eq!(history.steps.iter().filter(|s| s.undone).count(), 1);
    store.edits().redo(&reference)?;
    assert_eq!(
        coordinates(&read(&store, &reference, id("stream")).unwrap())[1],
        [10.0, 13.0]
    );
    std::fs::remove_file(path)
}

#[test]
fn an_inserted_vertex_takes_the_width_where_it_lies() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    store.edits().edit(
        &reference,
        &EditCommand::Reshape {
            id: id("stream"),
            geometry: serde_json::from_value(line(&[
                [0.0, 10.0],
                [10.0, 10.5],
                [15.0, 10.25],
                [20.0, 10.0],
                [30.0, 9.5],
            ]))
            .unwrap(),
        },
        &files(),
    )?;
    let widths = read(&store, &reference, id("stream")).unwrap().attributes["widths"].clone();
    assert_eq!(widths, json!([1.0, 1.5, 1.75, 2.0, 1.0]));
    std::fs::remove_file(path)
}

#[test]
fn a_line_snapped_onto_another_joins_it_and_follows_it() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    let outcome = store.edits().edit(
        &reference,
        &EditCommand::Create {
            layer_id: "vector:roads".into(),
            kind: "trail".into(),
            name: Some("Side path".into()),
            geometry: serde_json::from_value(line(&[[15.0, 5.0], [25.0, 5.0]])).unwrap(),
            attributes: BTreeMap::from([("widths".into(), json!([1.0, 1.0]))]),
            creator_layer: None,
        },
        &files(),
    )?;
    let side = outcome.created[0];
    assert!(outcome.changed.contains(&side));
    let joined = read(&store, &reference, side).unwrap();
    assert_eq!(joined.relations[0].target_id, id("trail"));
    assert_eq!(joined.relations[0].kind, "joins");
    store.edits().edit(
        &reference,
        &EditCommand::Transform {
            ids: vec![id("trail")],
            transform: Transform {
                translate: [-2.0, 0.0],
                rotate: 0.0,
                scale: 1.0,
                about: [0.0, 0.0],
            },
        },
        &files(),
    )?;
    assert_eq!(
        coordinates(&read(&store, &reference, side).unwrap())[0],
        [13.0, 5.0]
    );
    std::fs::remove_file(path)
}

#[test]
fn edits_are_validated_and_world_maps_stay_read_only() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    let wrong = store.edits().edit(
        &reference,
        &EditCommand::SetAttributes {
            ids: vec![id("stream")],
            name: None,
            attributes: BTreeMap::from([("widths".into(), json!([1.0]))]),
        },
        &files(),
    );
    assert!(wrong
        .unwrap_err()
        .to_string()
        .contains("one width for each point"));
    let outside = store.edits().edit(
        &reference,
        &EditCommand::Transform {
            ids: vec![id("log")],
            transform: Transform {
                translate: [100.0, 0.0],
                rotate: 0.0,
                scale: 1.0,
                about: [0.0, 0.0],
            },
        },
        &files(),
    );
    assert!(outside.unwrap_err().to_string().contains("inside the map"));
    store.edits().edit(
        &reference,
        &EditCommand::SetAttributes {
            ids: vec![id("log")],
            name: None,
            attributes: BTreeMap::from([("locked".into(), json!(true))]),
        },
        &files(),
    )?;
    let held = store.edits().edit(
        &reference,
        &EditCommand::Delete {
            ids: vec![id("log")],
        },
        &files(),
    );
    assert!(held.unwrap_err().to_string().contains("locked"));
    let world_path = temporary();
    let (world, world_ref) = publish(&world_path, "world", false)?;
    let refused = world.edits().edit(
        &world_ref,
        &EditCommand::Delete {
            ids: vec![id("log")],
        },
        &files(),
    );
    assert!(refused.unwrap_err().to_string().contains("read-only"));
    std::fs::remove_file(path)?;
    std::fs::remove_file(world_path)
}

#[test]
fn an_authored_map_is_not_replaced_by_regeneration() -> io::Result<()> {
    let path = temporary();
    let (mut store, reference) = publish(&path, "glen", true)?;
    store.edits().edit(
        &reference,
        &EditCommand::Delete {
            ids: vec![id("log")],
        },
        &files(),
    )?;
    let mut next = descriptor("glen", true);
    next.reference.revision = id("regenerated");
    let refused = store.begin(&next, Some(&reference), false);
    assert!(refused.unwrap_err().to_string().contains("edited by hand"));
    std::fs::remove_file(path)
}

#[test]
fn creator_layers_move_merge_and_delete_with_undo() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    let added = store.edits().edit(
        &reference,
        &EditCommand::AddLayer {
            name: "GM secrets".into(),
        },
        &files(),
    )?;
    let secret = added.map.real_scale.unwrap().creator_layers[1].id;
    store.edits().edit(
        &reference,
        &EditCommand::MoveToLayer {
            ids: vec![id("log")],
            layer: secret,
        },
        &files(),
    )?;
    assert_eq!(
        read(&store, &reference, id("log")).unwrap().attributes["creatorLayer"],
        json!(secret)
    );
    store.edits().edit(
        &reference,
        &EditCommand::LockLayer {
            id: secret,
            locked: true,
        },
        &files(),
    )?;
    let held = store.edits().edit(
        &reference,
        &EditCommand::Delete {
            ids: vec![id("log")],
        },
        &files(),
    );
    assert!(held.is_err(), "a locked layer refuses pointer edits");
    store.edits().edit(
        &reference,
        &EditCommand::LockLayer {
            id: secret,
            locked: false,
        },
        &files(),
    )?;
    let deleted = store.edits().edit(
        &reference,
        &EditCommand::DeleteLayer { id: secret },
        &files(),
    )?;
    assert_eq!(deleted.map.real_scale.unwrap().creator_layers.len(), 1);
    assert!(read(&store, &reference, id("log")).is_none());
    let restored = store.edits().undo(&reference)?;
    assert_eq!(restored.map.real_scale.unwrap().creator_layers.len(), 2);
    assert!(read(&store, &reference, id("log")).is_some());
    let merged =
        store
            .edits()
            .edit(&reference, &EditCommand::MergeDown { id: secret }, &files())?;
    assert_eq!(merged.map.real_scale.unwrap().creator_layers.len(), 1);
    assert_eq!(
        read(&store, &reference, id("log")).unwrap().attributes["creatorLayer"],
        json!(id("base"))
    );
    std::fs::remove_file(path)
}

#[test]
fn saving_an_authored_map_replaces_its_saved_copy() -> io::Result<()> {
    let working = temporary();
    let saved_path = temporary();
    let (store, reference) = publish(&working, "glen", true)?;
    let saved = MapStore::open_database(Rc::new(Database::open(&saved_path)?))?;
    let request = |version| SaveRequest {
        reference: reference.clone(),
        expected_version: version,
        navigation: Default::default(),
        settings: Default::default(),
    };
    let time = || "2026-11-16T00:00:00Z".to_string();
    saved.save_from(working.to_str().unwrap(), request(None), time())?;
    let at = |store: &MapStore| coordinates(&read(store, &reference, id("stream")).unwrap())[1];
    for (step, y) in [(1, 12.0), (2, 14.0)] {
        store.edits().edit(
            &reference,
            &EditCommand::Reshape {
                id: id("stream"),
                geometry: serde_json::from_value(line(&[
                    [0.0, 10.0],
                    [10.0, y],
                    [20.0, 10.0],
                    [30.0, 9.5],
                ]))
                .unwrap(),
            },
            &files(),
        )?;
        saved.save_from(working.to_str().unwrap(), request(Some(step)), time())?;
        assert_eq!(at(&saved), [10.0, y]);
        assert_eq!(
            saved.edits().edit_history(&reference)?.steps.len(),
            step as usize
        );
    }
    std::fs::remove_file(working)?;
    std::fs::remove_file(saved_path)
}

fn drag_to(store: &MapStore, reference: &MapRef, y: f64) -> io::Result<()> {
    let geometry = line(&[[0.0, 10.0], [10.0, y], [20.0, 10.0], [30.0, 9.5]]);
    store.edits().edit(
        reference,
        &EditCommand::Reshape {
            id: id("stream"),
            geometry: serde_json::from_value(geometry).unwrap(),
        },
        &files(),
    )?;
    Ok(())
}
#[test]
fn saving_a_parent_replaces_its_saved_authored_child() -> io::Result<()> {
    let working = temporary();
    let saved_path = temporary();
    let (_, world) = publish(&working, "world", false)?;
    let mut glen = descriptor("glen", true);
    glen.parent = Some(world.clone());
    let (store, child) = publish_map(&working, glen)?;
    let saved = MapStore::open_database(Rc::new(Database::open(&saved_path)?))?;
    let save = |reference: &MapRef, navigation: MapNavigationState, version| {
        let request = SaveRequest {
            reference: reference.clone(),
            expected_version: version,
            navigation,
            settings: Default::default(),
        };
        saved.save_from(
            working.to_str().unwrap(),
            request,
            "2026-11-16T00:00:00Z".into(),
        )
    };
    drag_to(&store, &child, 12.0)?;
    save(&child, Default::default(), None)?;
    drag_to(&store, &child, 14.0)?;
    let navigation: MapNavigationState = serde_json::from_value(json!({"version":1,"views":[],
        "regions":[{"id":"glen","name":"Glen","spaceId":id("surface"),"parentId":null,"child":child,
            "geometry":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}}]}))?;
    save(&world, navigation, None)?;
    assert_eq!(
        coordinates(&read(&saved, &child, id("stream")).unwrap())[1],
        [10.0, 14.0]
    );
    std::fs::remove_file(working)?;
    std::fs::remove_file(saved_path)
}

#[test]
fn a_regeneration_begun_before_the_first_edit_cannot_finish_over_it() -> io::Result<()> {
    let path = temporary();
    let (mut store, reference) = publish(&path, "glen", true)?;
    let mut next = descriptor("glen", true);
    next.reference.revision = id("regenerated");
    store.begin(&next, Some(&reference), false)?;
    drag_to(&store, &reference, 12.0)?;
    let refused = store.finish(&next.reference);
    assert!(refused.unwrap_err().to_string().contains("edited by hand"));
    std::fs::remove_file(path)
}

#[test]
fn hexes_and_locked_layers_refuse_edits() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    let hex = store
        .features(
            &reference,
            &FeatureQuery {
                space_id: id("surface"),
                layer_ids: Some(vec!["vector:hexes".into()]),
                ..Default::default()
            },
        )?
        .items
        .remove(0);
    let refused = store.edits().edit(
        &reference,
        &EditCommand::Delete { ids: vec![hex.id] },
        &files(),
    );
    assert!(
        refused.is_err(),
        "hexes are derived and never edited by hand"
    );
    let added = store.edits().edit(
        &reference,
        &EditCommand::AddLayer {
            name: "Secrets".into(),
        },
        &files(),
    )?;
    let secret = added.map.real_scale.unwrap().creator_layers[1].id;
    store.edits().edit(
        &reference,
        &EditCommand::LockLayer {
            id: secret,
            locked: true,
        },
        &files(),
    )?;
    let into = store.edits().edit(
        &reference,
        &EditCommand::MoveToLayer {
            ids: vec![id("log")],
            layer: secret,
        },
        &files(),
    );
    assert!(into.unwrap_err().to_string().contains("Unlock"));
    store.edits().edit(
        &reference,
        &EditCommand::LockLayer {
            id: secret,
            locked: false,
        },
        &files(),
    )?;
    store.edits().edit(
        &reference,
        &EditCommand::MoveToLayer {
            ids: vec![id("log")],
            layer: secret,
        },
        &files(),
    )?;
    store.edits().edit(
        &reference,
        &EditCommand::LockLayer {
            id: secret,
            locked: true,
        },
        &files(),
    )?;
    let renamed = store.edits().edit(
        &reference,
        &EditCommand::SetAttributes {
            ids: vec![id("log")],
            name: Some("Oak".into()),
            attributes: BTreeMap::new(),
        },
        &files(),
    );
    assert!(renamed.unwrap_err().to_string().contains("locked layer"));
    std::fs::remove_file(path)
}

#[test]
fn a_stream_drawn_under_a_bridge_is_spanned_by_it() -> io::Result<()> {
    let path = temporary();
    let (store, reference) = publish(&path, "glen", true)?;
    let bridge_id = bridge(&store, &reference);
    store.edits().edit(
        &reference,
        &EditCommand::Delete {
            ids: vec![id("stream")],
        },
        &files(),
    )?;
    let kinds = |store: &MapStore| {
        let found = read(store, &reference, bridge_id).unwrap();
        let mut pairs: Vec<_> = found.relations.iter().map(|r| r.kind.clone()).collect();
        pairs.sort();
        pairs
    };
    assert_eq!(kinds(&store), ["carries"]);
    store.edits().edit(
        &reference,
        &EditCommand::Create {
            layer_id: "vector:rivers".into(),
            kind: "stream".into(),
            name: Some("New burn".into()),
            geometry: serde_json::from_value(line(&[[10.0, 10.0], [20.0, 10.0]])).unwrap(),
            attributes: BTreeMap::new(),
            creator_layer: None,
        },
        &files(),
    )?;
    assert_eq!(kinds(&store), ["carries", "spans"]);
    std::fs::remove_file(path)
}
