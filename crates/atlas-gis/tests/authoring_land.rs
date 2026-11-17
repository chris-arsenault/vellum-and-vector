#![cfg(not(target_arch = "wasm32"))]
//! Land and cave tools on a small supplied real-scale map: placing and scattering objects,
//! a hex's ground and cover, and cave walls reading the published rock and magic they cut.
use atlas_gis::{
    map_store::{FeatureQuery, MapStore},
    sql::Database,
};
use atlas_map::{
    authoring::{EditCommand, Transform},
    hexes::HexGrid,
    Geometry, MapDescriptor, MapFeature, MapRef, MapSample, PublicationBatch, Publisher,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf, rc::Rc};

const LAYERS: [(&str, &[&str]); 4] = [
    ("rivers", &["stream"]),
    ("roads", &["trail"]),
    ("objects", &["log", "rubble", "boulder", "sign"]),
    ("hexes", &["hex"]),
];
const SURFACE: &str = "surface";
const UNDERGROUND: &str = "surface:underground";

/// The catalogue's true sizes the supplied object kinds publish: (typical, elongation, round).
fn true_size(kind: &str) -> Value {
    let (typical, elongation, round) = match kind {
        "log" => (0.5, 8.0, false),
        "rubble" => (1.0, 1.3, true),
        "boulder" => (0.8, 1.3, true),
        _ => return Value::Null,
    };
    json!({"least":typical / 2.0,"typical":typical,"largest":typical * 3.0,"elongation":elongation,"round":round})
}
fn catalog(name: &str, kinds: &[&str]) -> Value {
    let types: Vec<Value> = kinds
        .iter()
        .map(|kind| {
            let mut entry = json!({"id":kind,"kind":kind,"label":kind,"path":[name],"magicDepiction":null,
                "count":0,"geometries":[],"footprints":false});
            if !true_size(kind).is_null() {
                entry["trueSize"] = true_size(kind);
            }
            entry
        })
        .collect();
    json!({"path":[name],"common":true,"featureTypes":types,"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]})
}
fn band(id: &str, categories: Value) -> Value {
    let unit = if categories.as_array().is_some_and(|c| c.is_empty()) {
        "ratio"
    } else {
        "category"
    };
    json!({"id":id,"name":id,"unit":unit,"display":{"unit":unit,"factor":1},"nodata":null,"range":null,"categories":categories})
}
/// The published facts layer whose samples a cave wall reads: rock kind and magic coverage.
fn facts() -> Value {
    let rock = json!([
        {"value":3,"label":"Limestone","color":null,"surface":null,"present":true,"soluble":true},
        {"value":10,"label":"Granite","color":null,"surface":null,"present":true,"soluble":false}]);
    let bands = [
        band("RockLayerKind0", rock),
        band("magic:fire:coverage:vein", json!([])),
        band("magic:aurora:coverage", json!([])),
    ];
    json!({"id":"inspection","name":"Facts","spaceId":SURFACE,"bounds":[0,0,30,20],"attribution":[],
        "source":{"kind":"attributes","data":{"bands":bands}},"catalog":catalog("Facts", &[])})
}
fn descriptor() -> MapDescriptor {
    let mut layers: Vec<Value> = LAYERS
        .iter()
        .map(|(id, kinds)| {
            json!({"id":format!("vector:{id}"),"name":id,"spaceId":SURFACE,"bounds":[0,0,30,20],
            "attribution":[],"catalog":catalog(id, kinds),
            "source":{"kind":"vector","data":{"assetId":id,"mediaType":"application/geo+json"}}})
        })
        .collect();
    layers.push(facts());
    serde_json::from_value(json!({
        "reference":{"mapId":"glen","revision":"published"},"worldId":"world","name":"Glen","parent":null,
        "state":"incomplete","profile":"local","primarySpaceId":SURFACE,"bounds":[0,0,30,20],
        "footprint":{"type":"Polygon","coordinates":[[[0,0],[30,0],[30,20],[0,20],[0,0]]]},
        "regionScale":{"level":0,"nextArea":25,"subdivision":7,"minimumWidth":0.01,"enabled":false},
        "spaces":[{"id":SURFACE,"parentSpaceId":null,"bounds":[0,0,30,20],"metresPerUnit":1,"precision":0.000001,
            "periodicWidth":null,"frame":{"origin":[0,0,0],"rotation":0,"floor":null}}],
        "layers":layers,
        "realScale":{"kind":"ground","hexSize":"1.5m","acrossFlats":1.5,"feet":5,"origin":[15,10],
            "trianglesPerEdge":2,"creatorLayers":[{"id":"base","name":"Base layer"}],"edits":0,
            "authoring":{"groundClasses":[{"id":"Grassland","label":"Grassland","color":"#9c3"},
                {"id":"Bog","label":"Bog","color":"#563"}],"coverClasses":[],"latentLayers":[]}}
    }))
    .unwrap()
}
fn feature(id: &str, layer: &str, kind: &str, geometry: Value, attributes: Value) -> MapFeature {
    serde_json::from_value(json!({"id":id,"name":id,"spaceId":SURFACE,"layerId":format!("vector:{layer}"),
        "typeId":kind,"kind":kind,"entityId":null,"geometry":geometry,"footprint":null,"attributes":attributes,
        "relations":[],"causes":[],"catalog":{"values":{},"columns":[],"origin":"Generated","mapOnly":false}}))
    .unwrap()
}
fn grid() -> HexGrid {
    HexGrid::from_across_flats(1.5, [15.0, 10.0]).unwrap()
}
fn hexes() -> Vec<MapFeature> {
    let grid = grid();
    grid.covering(atlas_map::Bounds(0.0, 0.0, 30.0, 20.0))
        .into_iter()
        .map(|hex| {
            let mut hex = feature(&format!("hex:{}:{}", hex.q, hex.r), "hexes", "hex",
                serde_json::to_value(grid.polygon(hex)).unwrap(),
                json!({"q":hex.q,"r":hex.r,"marks":{},"fill":null,"ground":"Grassland","nameStatus":"label"}));
            hex.name = None;
            hex
        })
        .collect()
}
/// West of x 15 limestone under no magic; east of it granite under a Fire vein and Aurora.
fn samples() -> Vec<MapSample> {
    let cell = |id: &str, w: f64, rock: f64, vein: f64, aurora: f64| {
        let e = w + 15.0;
        let attribute = |band: &str, value: f64| {
            let unit = if band == "RockLayerKind0" {
                "category"
            } else {
                "ratio"
            };
            json!({"layerId":"inspection","bandId":band,"value":value,
                "unit":unit,"label":band,"display":{"unit":unit,"factor":1},"category":null})
        };
        serde_json::from_value(json!({"id":id,"spaceId":SURFACE,
            "footprint":{"type":"Polygon","coordinates":[[[w,0],[e,0],[e,20],[w,20],[w,0]]]},
            "window":{"bounds":[w,0,e,20],"closedEast":e == 30.0,"closedNorth":true},"cellSpan":15,
            "center":[w + 7.5,10],"measure":300,"active":true,"sections":[],
            "attributes":[attribute("RockLayerKind0", rock), attribute("magic:fire:coverage:vein", vein),
                attribute("magic:aurora:coverage", aurora)]}))
        .unwrap()
    };
    vec![
        cell("west", 0.0, 3.0, 0.0, 0.0),
        cell("east", 15.0, 10.0, 0.5, 0.3),
    ]
}
fn line(points: &[[f64; 2]]) -> Geometry {
    serde_json::from_value(json!({"type":"LineString","coordinates":points})).unwrap()
}
fn outline(w: f64, s: f64, e: f64, n: f64) -> Geometry {
    serde_json::from_value(
        json!({"type":"Polygon","coordinates":[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}),
    )
    .unwrap()
}
fn publish() -> (MapStore, MapRef) {
    let path: PathBuf =
        std::env::temp_dir().join(format!("atlas-land-{}.sqlite", uuid::Uuid::new_v4()));
    let map = descriptor();
    let mut store = MapStore::open_database(Rc::new(Database::open(path).unwrap())).unwrap();
    store.begin(&map, None, false).unwrap();
    let mut features = vec![feature(
        "stream",
        "rivers",
        "stream",
        json!({"type":"LineString","coordinates":[[0,10],[30,10]]}),
        json!({"widths":[1.0,1.0]}),
    )];
    features.extend(hexes());
    let assets = LAYERS
        .iter()
        .map(|(id, ..)| {
            serde_json::from_value(json!({"id":id,"location":format!("{id}.geojson"),
            "mediaType":"application/geo+json","byteLength":10,"illustration":false}))
            .unwrap()
        })
        .collect();
    store
        .append(
            &map.reference,
            PublicationBatch {
                features,
                samples: samples(),
                assets,
                ..Default::default()
            },
        )
        .unwrap();
    store.finish(&map.reference).unwrap();
    (store, map.reference)
}
fn in_space(store: &MapStore, reference: &MapRef, space: &str, layer: &str) -> Vec<MapFeature> {
    let mut query = FeatureQuery {
        space_id: space.into(),
        layer_ids: Some(vec![layer.into()]),
        ..Default::default()
    };
    let mut items = Vec::new();
    loop {
        let page = store.features(reference, &query).unwrap();
        items.extend(page.items);
        if page.next.is_none() {
            return items;
        }
        query.cursor = page.next;
    }
}
fn objects(store: &MapStore, reference: &MapRef) -> Vec<MapFeature> {
    in_space(store, reference, SURFACE, "vector:objects")
}
fn centre(feature: &MapFeature) -> [f64; 2] {
    let Geometry::Polygon { coordinates } = &feature.geometry else {
        panic!("an object is an outline")
    };
    let ring = &coordinates[0][..coordinates[0].len() - 1];
    let sum = ring.iter().fold([0.0, 0.0], |[x, y], p| {
        let [px, py, _] = p.coordinates();
        [x + px, y + py]
    });
    [sum[0] / ring.len() as f64, sum[1] / ring.len() as f64]
}
fn scatter(seed: u32, spacing: f64) -> EditCommand {
    EditCommand::Scatter {
        layer_id: "vector:objects".into(),
        kind: "rubble".into(),
        outline: outline(2.0, 2.0, 12.0, 8.0),
        spacing,
        seed,
        creator_layer: None,
    }
}

#[test]
fn placing_sets_down_one_object_at_its_kinds_size_turned_and_scaled() {
    let (store, reference) = publish();
    let outcome = store
        .edits()
        .edit(
            &reference,
            &EditCommand::Place {
                layer_id: "vector:objects".into(),
                kind: "log".into(),
                name: Some("Fallen oak".into()),
                at: [8.0, 8.0],
                rotation: 90.0,
                scale: 1.5,
                creator_layer: None,
            },
        )
        .unwrap();
    assert_eq!(outcome.history.steps[0].label, "Place Fallen oak");
    let [log] = objects(&store, &reference).try_into().unwrap();
    assert_eq!(log.attributes["rotation"], json!(90.0));
    let Geometry::Polygon { coordinates } = &log.geometry else {
        panic!("an object is an outline")
    };
    let span = |axis: usize| {
        let values: Vec<f64> = coordinates[0]
            .iter()
            .map(|p| p.coordinates()[axis])
            .collect();
        values.iter().cloned().fold(f64::MIN, f64::max)
            - values.iter().cloned().fold(f64::MAX, f64::min)
    };
    // A 4 m log at 1.5 times, turned to run north: 6 m north to south and 0.75 m across.
    assert!((span(1) - 6.0).abs() < 1e-6);
    assert!((span(0) - 0.75).abs() < 1e-6);
    let refused = store.edits().edit(
        &reference,
        &EditCommand::Place {
            layer_id: "vector:objects".into(),
            kind: "log".into(),
            name: None,
            at: [8.0, 8.0],
            rotation: 0.0,
            scale: 0.0,
            creator_layer: None,
        },
    );
    assert!(refused.is_err());
    // A kind the catalogue gives no true size is not placed at a made-up one.
    let no_size = EditCommand::Place {
        layer_id: "vector:objects".into(),
        kind: "sign".into(),
        name: None,
        at: [8.0, 8.0],
        rotation: 0.0,
        scale: 1.0,
        creator_layer: None,
    };
    let error = store.edits().edit(&reference, &no_size).unwrap_err();
    assert!(error.to_string().contains("no true size"), "{error}");
}
#[test]
fn a_scatter_keeps_its_spacing_repeats_from_its_seed_and_undoes_as_one_step() {
    let (store, reference) = publish();
    let outcome = store.edits().edit(&reference, &scatter(4, 1.5)).unwrap();
    let laid = objects(&store, &reference);
    assert!(laid.len() > 8, "{} objects", laid.len());
    assert_eq!(
        outcome.history.steps[0].label,
        format!("Scatter {} rubble", laid.len())
    );
    let mut centres: Vec<[f64; 2]> = laid.iter().map(centre).collect();
    centres.sort_by(|a, b| a.partial_cmp(b).unwrap());
    for (i, a) in centres.iter().enumerate() {
        assert!(a[0] >= 2.0 && a[0] <= 12.0 && a[1] >= 2.0 && a[1] <= 8.0);
        for b in &centres[i + 1..] {
            assert!((a[0] - b[0]).hypot(a[1] - b[1]) >= 1.5 - 1e-9);
        }
    }
    store.edits().undo(&reference).unwrap();
    assert!(objects(&store, &reference).is_empty());
    store.edits().edit(&reference, &scatter(4, 1.5)).unwrap();
    let mut again: Vec<[f64; 2]> = objects(&store, &reference).iter().map(centre).collect();
    again.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert_eq!(again, centres);
    let crowded = store.edits().edit(&reference, &scatter(4, 0.01));
    assert!(crowded.unwrap_err().to_string().contains("wider spacing"));
}
fn hex_at(store: &MapStore, reference: &MapRef, at: [f64; 2]) -> MapFeature {
    let hex = grid().hex_at(at);
    let query = FeatureQuery {
        space_id: SURFACE.into(),
        feature_ids: Some(vec![format!("hex:{}:{}", hex.q, hex.r)]),
        ..Default::default()
    };
    store
        .features(reference, &query)
        .unwrap()
        .items
        .pop()
        .unwrap()
}
fn set_hexes(ids: Vec<String>, name: Option<&str>, attributes: Value) -> EditCommand {
    EditCommand::SetAttributes {
        ids,
        name: name.map(Into::into),
        attributes: serde_json::from_value::<BTreeMap<String, Value>>(attributes).unwrap(),
    }
}
#[test]
fn a_hex_takes_a_ground_and_cover_class_that_re_marking_keeps_and_undo_restores() {
    let (store, reference) = publish();
    let ids = vec![
        hex_at(&store, &reference, [5.0, 5.0]).id,
        hex_at(&store, &reference, [5.0, 10.0]).id,
    ];
    let set = set_hexes(ids.clone(), None, json!({"ground":"Bog","cover":"heavy"}));
    let outcome = store.edits().edit(&reference, &set).unwrap();
    assert_eq!(
        outcome.history.steps[0].label,
        "Set cover and ground of 2 hexes"
    );
    let marked = hex_at(&store, &reference, [5.0, 10.0]);
    assert_eq!(marked.attributes["ground"], json!("Bog"));
    assert_eq!(marked.attributes["cover"], json!("heavy"));
    // Moving the stream off the hex re-marks it and keeps the authored classes.
    let moved = EditCommand::Reshape {
        id: "stream".into(),
        geometry: line(&[[0.0, 14.0], [30.0, 14.0]]),
    };
    store.edits().edit(&reference, &moved).unwrap();
    let remarked = hex_at(&store, &reference, [5.0, 10.0]);
    assert_eq!(remarked.attributes["ground"], json!("Bog"));
    assert!(remarked.attributes["marks"].get("water").is_none());
    store.edits().undo(&reference).unwrap();
    store.edits().undo(&reference).unwrap();
    let restored = hex_at(&store, &reference, [5.0, 10.0]);
    assert_eq!(restored.attributes["ground"], json!("Grassland"));
    assert!(!restored.attributes.contains_key("cover"));
}
#[test]
fn hexes_refuse_every_edit_but_their_ground_and_cover() {
    let (store, reference) = publish();
    let hex = hex_at(&store, &reference, [5.0, 5.0]).id;
    let refused = [
        set_hexes(vec![hex.clone()], None, json!({"fill":"water"})),
        set_hexes(vec![hex.clone()], None, json!({"cover":"dense"})),
        set_hexes(vec![hex.clone()], None, json!({"ground":"Moon dust"})),
        set_hexes(vec![hex.clone()], Some("My hex"), json!({"ground":"Bog"})),
        set_hexes(
            vec![hex.clone(), "stream".into()],
            None,
            json!({"ground":"Bog"}),
        ),
        EditCommand::Delete {
            ids: vec![hex.clone()],
        },
        EditCommand::Transform {
            ids: vec![hex.clone()],
            transform: Transform {
                translate: [1.0, 0.0],
                rotate: 0.0,
                scale: 1.0,
                about: [0.0, 0.0],
            },
        },
    ];
    for command in refused {
        assert!(
            store.edits().edit(&reference, &command).is_err(),
            "{command:?}"
        );
    }
    assert!(store
        .edits()
        .edit_history(&reference)
        .unwrap()
        .steps
        .is_empty());
}
fn wall(points: &[[f64; 2]]) -> EditCommand {
    EditCommand::Create {
        layer_id: "vector:caveWalls".into(),
        kind: "caveWall".into(),
        name: None,
        geometry: line(points),
        attributes: serde_json::from_value(json!({"widths":vec![0.5; points.len()]})).unwrap(),
        creator_layer: None,
    }
}
fn cave_wall(store: &MapStore, reference: &MapRef, id: &str) -> MapFeature {
    in_space(store, reference, UNDERGROUND, "vector:caveWalls")
        .into_iter()
        .find(|wall| wall.id == id)
        .unwrap()
}
/// A wall's mark on the cave hex at a point, and none on the surface hex above it.
fn wall_mark(store: &MapStore, reference: &MapRef, at: [f64; 2]) -> f64 {
    let hex = grid().hex_at(at);
    let under = in_space(store, reference, UNDERGROUND, "vector:caveHexes")
        .into_iter()
        .find(|cave| cave.id == format!("cave-hex:{}:{}", hex.q, hex.r))
        .unwrap();
    let surface = hex_at(store, reference, at);
    assert!(surface.attributes["marks"].get("wall").is_none());
    under.attributes["marks"]["wall"].as_f64().unwrap_or(0.0)
}
fn draw_wall(store: &MapStore, reference: &MapRef, points: &[[f64; 2]]) -> MapFeature {
    let outcome = store.edits().edit(reference, &wall(points)).unwrap();
    let [id] = outcome.changed.try_into().unwrap();
    cave_wall(store, reference, &id)
}
#[test]
fn the_first_cave_wall_opens_the_underground_and_reads_the_limestone_it_cuts() {
    let (store, reference) = publish();
    let limestone = draw_wall(&store, &reference, &[[3.0, 5.0], [12.0, 5.0]]);
    let map = store.open(&reference).unwrap();
    assert!(map.spaces.iter().any(|space| space.id == UNDERGROUND));
    let cave_hexes = in_space(&store, &reference, UNDERGROUND, "vector:caveHexes");
    assert_eq!(cave_hexes.len(), hexes().len());
    assert_eq!(limestone.attributes["rock"], json!(["Limestone"]));
    assert_eq!(limestone.attributes["wallFeatures"], json!(["flowstone"]));
    // The first wall marks the cave grid it opened.
    assert!(wall_mark(&store, &reference, [7.0, 5.0]) > 0.1);
}
#[test]
fn a_wall_under_fire_and_aurora_shows_seams_and_rime_and_a_moved_wall_reads_again() {
    let (store, reference) = publish();
    let limestone = draw_wall(&store, &reference, &[[3.0, 5.0], [12.0, 5.0]]);
    let granite = draw_wall(&store, &reference, &[[18.0, 15.0], [28.0, 15.0]]);
    assert_eq!(granite.attributes["rock"], json!(["Granite"]));
    assert_eq!(granite.attributes["wallFeatures"], json!(["seams", "rime"]));
    assert!(wall_mark(&store, &reference, [23.0, 15.0]) > 0.1);
    let across = EditCommand::Reshape {
        id: limestone.id.clone(),
        geometry: line(&[[3.0, 5.0], [25.0, 5.0]]),
    };
    store.edits().edit(&reference, &across).unwrap();
    let moved = cave_wall(&store, &reference, &limestone.id);
    assert_eq!(moved.attributes["rock"], json!(["Limestone", "Granite"]));
    let features = json!(["flowstone", "seams", "rime"]);
    assert_eq!(moved.attributes["wallFeatures"], features);
}
#[test]
fn undoing_the_first_cave_wall_closes_the_underground_and_redo_opens_it() {
    let (store, reference) = publish();
    store
        .edits()
        .edit(&reference, &wall(&[[3.0, 5.0], [12.0, 5.0]]))
        .unwrap();
    let undone = store.edits().undo(&reference).unwrap();
    assert!(!undone
        .map
        .spaces
        .iter()
        .any(|space| space.id == UNDERGROUND));
    assert!(!undone
        .map
        .layers
        .iter()
        .any(|layer| layer.id == "vector:caveWalls"));
    let redone = store.edits().redo(&reference).unwrap();
    assert!(redone
        .map
        .spaces
        .iter()
        .any(|space| space.id == UNDERGROUND));
    assert_eq!(
        in_space(&store, &reference, UNDERGROUND, "vector:caveHexes").len(),
        hexes().len()
    );
    // Redo marks the reopened grid with the wall again.
    assert!(wall_mark(&store, &reference, [7.0, 5.0]) > 0.1);
}
fn lock(store: &MapStore, reference: &MapRef, id: &str, locked: bool) {
    let command = EditCommand::LockLayer {
        id: id.into(),
        locked,
    };
    store.edits().edit(reference, &command).unwrap();
}
fn add_layer(store: &MapStore, reference: &MapRef, name: &str) -> String {
    let command = EditCommand::AddLayer { name: name.into() };
    let map = store.edits().edit(reference, &command).unwrap().map;
    map.real_scale
        .unwrap()
        .creator_layers
        .last()
        .unwrap()
        .id
        .clone()
}
/// A hex belongs to no creator layer: a locked layer neither holds a hex edit nor its undo.
#[test]
fn hex_edits_and_their_undo_ignore_creator_layer_locks() {
    let (store, reference) = publish();
    lock(&store, &reference, "base", true);
    let hex = hex_at(&store, &reference, [5.0, 5.0]).id;
    let set = set_hexes(vec![hex], None, json!({"cover":"light"}));
    store.edits().edit(&reference, &set).unwrap();
    store.edits().undo(&reference).unwrap();
    store.edits().redo(&reference).unwrap();
    assert_eq!(
        hex_at(&store, &reference, [5.0, 5.0]).attributes["cover"],
        json!("light")
    );
}
/// The grid a first wall opens comes and goes with its layer: with the base layer locked, a
/// wall drawn into an open layer is undone and redone, while the base layer's own features
/// stay held by its lock.
#[test]
fn a_first_wall_in_an_open_layer_undoes_under_a_locked_base_whose_features_stay_held() {
    let (store, reference) = publish();
    let caves = add_layer(&store, &reference, "Caves");
    lock(&store, &reference, "base", true);
    let mut drawn = wall(&[[3.0, 5.0], [12.0, 5.0]]);
    if let EditCommand::Create { creator_layer, .. } = &mut drawn {
        *creator_layer = Some(caves);
    }
    store.edits().edit(&reference, &drawn).unwrap();
    let undone = store.edits().undo(&reference).unwrap();
    assert!(!undone.map.spaces.iter().any(|s| s.id == UNDERGROUND));
    store.edits().redo(&reference).unwrap();
    assert!(wall_mark(&store, &reference, [7.0, 5.0]) > 0.1);
    let held = set_hexes(vec!["stream".into()], Some("Burn"), json!({}));
    assert!(store.edits().edit(&reference, &held).is_err());
    assert!(store
        .edits()
        .edit(&reference, &wall(&[[3.0, 9.0], [9.0, 9.0]]))
        .is_err());
}
