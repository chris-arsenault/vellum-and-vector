#![cfg(not(target_arch = "wasm32"))]
//! A building's floors map on a small supplied ground map: the shell from the footprint with
//! its front wall and door, levels from storeys, level commands with undo, connections to
//! another level and to a cave passage on the parent, and the outside context read from the
//! parent's published samples.
use atlas_gis::{
    map_files::MapFiles,
    map_protocol::ReadCall,
    map_store::{codec, FeatureQuery, MapStore},
    sql::Database,
};
use atlas_host::structure_maps::open_floors;
use atlas_map::{
    authoring::EditCommand,
    structure::{levels, ConnectionTarget, SiteContext},
    MapDescriptor, MapFeature, MapRef, PublicationBatch, Publisher,
};
use serde_json::{json, Value};
use std::{path::PathBuf, rc::Rc};

const SURFACE: &str = "surface";
const UNDER: &str = "surface:underground";
const COVERAGE: &str = "magic:aurora:coverage";

fn layer(id: &str, space: &str, kinds: &[&str]) -> Value {
    let types: Vec<Value> = kinds
        .iter()
        .map(|kind| json!({"id":kind,"kind":kind,"label":kind,"path":[id],"magicDepiction":null,"count":0,"geometries":[],"footprints":false}))
        .collect();
    json!({"id":format!("vector:{id}"),"name":id,"spaceId":space,"bounds":[0,0,40,30],"attribution":[],
        "catalog":{"path":[id],"common":true,"featureTypes":types,"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]},
        "source":{"kind":"vector","data":{"assetId":id,"mediaType":"application/geo+json"}}})
}
fn space(id: &str, parent: Option<&str>, floor: Option<&str>) -> Value {
    json!({"id":id,"parentSpaceId":parent,"bounds":[0,0,40,30],"metresPerUnit":1,"precision":0.000001,
        "periodicWidth":null,"frame":{"origin":[0,0,0],"rotation":0,"floor":floor}})
}
fn parent() -> MapDescriptor {
    let structures = [
        "building",
        "wall",
        "door",
        "window",
        "stair",
        "ladder",
        "trapdoor",
        "furniture",
    ];
    let mut layers = vec![
        layer("roads", SURFACE, &["street"]),
        layer("structures", SURFACE, &structures),
        layer("objects", SURFACE, &["decor"]),
        layer("hexes", SURFACE, &["hex"]),
        layer("magic", SURFACE, &["aurora:rime"]),
        layer("caves", UNDER, &["dissolvedPassage"]),
    ];
    layers.push(json!({"id":"inspection","name":"Facts","spaceId":SURFACE,"bounds":[0,0,40,30],"attribution":[],
        "source":{"kind":"attributes","data":{"bands":[{"id":COVERAGE,"name":"Aurora coverage","unit":"ratio",
            "display":{"unit":"ratio","factor":1.0},"nodata":null,"categories":[],"range":null}]}},
        "catalog":{"path":[],"common":false,"featureTypes":[],"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]}}));
    serde_json::from_value(json!({
        "reference":{"mapId":"glen","revision":"published"},"worldId":"world","name":"Glen","parent":null,
        "state":"incomplete","profile":"local","primarySpaceId":SURFACE,"bounds":[0,0,40,30],
        "footprint":{"type":"Polygon","coordinates":[[[0,0],[40,0],[40,30],[0,30],[0,0]]]},
        "regionScale":{"level":0,"nextArea":25,"subdivision":7,"minimumWidth":0.01,"enabled":false},
        "spaces":[space(SURFACE, None, None), space(UNDER, Some(SURFACE), Some("underground"))],
        "layers":layers,
        "realScale":{"kind":"ground","hexSize":"1.5m","acrossFlats":1.5,"feet":5,"origin":[20,15],
            "trianglesPerEdge":2,"creatorLayers":[{"id":"base","name":"Base layer"}],"edits":0}
    }))
    .unwrap()
}
fn feature(
    id: &str,
    space: &str,
    layer: &str,
    kind: &str,
    geometry: Value,
    attributes: Value,
) -> MapFeature {
    serde_json::from_value(json!({"id":id,"name":id,"spaceId":space,"layerId":format!("vector:{layer}"),"typeId":kind,
        "kind":kind,"entityId":null,"geometry":geometry,"footprint":null,"attributes":attributes,"relations":[],"causes":[],
        "catalog":{"values":{},"columns":[],"origin":"Generated geography","mapOnly":false}}))
    .unwrap()
}
fn sample() -> atlas_map::MapSample {
    serde_json::from_value(json!({"id":"site","spaceId":SURFACE,
        "footprint":{"type":"Polygon","coordinates":[[[0,0],[40,0],[40,30],[0,30],[0,0]]]},
        "window":{"bounds":[0,0,40,30],"closedEast":true,"closedNorth":true},"cellSpan":40,"center":[20,15],
        "measure":1200,"active":true,"sections":[],
        "attributes":[{"layerId":"inspection","bandId":COVERAGE,"value":0.35,"unit":"ratio","label":"Aurora coverage",
            "display":{"unit":"ratio","factor":1.0},"category":null}]}))
    .unwrap()
}
fn temporary(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("atlas-structure-{name}-{}", uuid::Uuid::new_v4()))
}
fn published() -> (MapStore, MapRef, MapFiles) {
    let (store, reference, files, _) = published_at();
    (store, reference, files)
}
/// The supplied ground map in a working catalog, with the catalog's path for saving.
fn published_at() -> (MapStore, MapRef, MapFiles, PathBuf) {
    let path = temporary("maps");
    let mut store = MapStore::open_database(Rc::new(Database::open(&path).unwrap())).unwrap();
    let map = parent();
    store.begin(&map, None, false).unwrap();
    let mut inn = feature(
        "inn",
        SURFACE,
        "structures",
        "building",
        json!({"type":"Polygon","coordinates":[[[10,10],[20,10],[20,16],[10,16],[10,10]]]}),
        json!({"use":"inn","storeys":2,"address":"3 Drovers' Way","street":"Drovers' Way","ward":"Glenfoot","settlement":"Glen"}),
    );
    inn.name = Some("The Rowan".into());
    inn.relations = serde_json::from_value(
        json!([{"targetId":"street","targetName":"Drovers' Way","kind":"fronts"}]),
    )
    .unwrap();
    let mut street = feature(
        "street",
        SURFACE,
        "roads",
        "street",
        json!({"type":"LineString","coordinates":[[0,20],[40,20]]}),
        json!({}),
    );
    street.name = Some("Drovers' Way".into());
    let features = vec![
        street,
        inn,
        feature(
            "passage",
            UNDER,
            "caves",
            "dissolvedPassage",
            json!({"type":"LineString","coordinates":[[12,12],[30,12]]}),
            json!({}),
        ),
        feature(
            "rime",
            SURFACE,
            "magic",
            "aurora:rime",
            json!({"type":"Point","coordinates":[25,18]}),
            json!({}),
        ),
        // A yard door beside the inn, on the parent's surface.
        feature(
            "yard-door",
            SURFACE,
            "structures",
            "door",
            json!({"type":"Polygon","coordinates":[[[21,17],[22,17],[22,18],[21,18],[21,17]]]}),
            json!({}),
        ),
    ];
    let assets = ["roads", "structures", "objects", "hexes", "magic", "caves"]
        .iter()
        .map(|id| serde_json::from_value(json!({"id":id,"location":format!("{id}.geojson"),"mediaType":"application/geo+json","byteLength":10,"illustration":false})).unwrap())
        .collect();
    store
        .append(
            &map.reference,
            PublicationBatch {
                features,
                samples: vec![sample()],
                assets,
                ..Default::default()
            },
        )
        .unwrap();
    store.finish(&map.reference).unwrap();
    (
        store,
        map.reference,
        MapFiles::new(temporary("assets")),
        path,
    )
}
fn level_features(store: &MapStore, map: &MapDescriptor, space: &str) -> Vec<MapFeature> {
    let query = FeatureQuery {
        space_id: space.into(),
        ..Default::default()
    };
    store
        .access()
        .features(&map.reference, &query)
        .unwrap()
        .items
}
fn edit(store: &MapStore, reference: &MapRef, command: Value) -> atlas_map::authoring::EditOutcome {
    let command: EditCommand = serde_json::from_value(command).unwrap();
    store.edits().edit(reference, &command).unwrap()
}
fn trapdoor(layer: &str, at: [f64; 2]) -> Value {
    let [x, y] = at;
    json!({"command":"create","layerId":layer,"kind":"trapdoor","name":"Cellar trapdoor",
        "geometry":{"type":"Polygon","coordinates":[[[x,y],[x+1.0,y],[x+1.0,y+1.0],[x,y+1.0],[x,y]]]},
        "attributes":{},"creatorLayer":null})
}

#[test]
fn an_inn_opens_to_its_shell_on_every_level() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, "inn").unwrap();
    assert_eq!(
        open_floors(&mut store, &files, &glen, "inn").unwrap(),
        floors,
        "opens once"
    );
    let map = store.access().open(&floors).unwrap();
    assert_eq!(map.parent.as_ref(), Some(&glen));
    let real = map.real_scale.as_ref().unwrap();
    assert_eq!(real.site.as_ref().unwrap().building_id, "inn");
    assert_eq!(
        real.site.as_ref().unwrap().address.as_deref(),
        Some("3 Drovers' Way")
    );
    // Two storeys and a cellar.
    let numbers: Vec<i32> = levels(&map).into_iter().map(|(n, _)| n).collect();
    assert_eq!(numbers, vec![-1, 0, 1]);
    ground_floor_shell(&store, &map);
    let cellar = level_features(&store, &map, "surface:level:-1");
    assert_eq!(cellar.iter().filter(|f| f.kind == "wall").count(), 4);
    assert!(
        cellar.iter().all(|f| f.kind != "door"),
        "only the ground floor opens to the street"
    );
    assert!(map
        .layers
        .iter()
        .any(|l| l.id == "vector:structures@-1" && l.space_id == "surface:level:-1"));
}
/// Four outer walls, the north one the front facing the street, with the street door in it.
fn ground_floor_shell(store: &MapStore, map: &MapDescriptor) {
    let ground = level_features(store, map, SURFACE);
    let walls: Vec<_> = ground.iter().filter(|f| f.kind == "wall").collect();
    assert_eq!(walls.len(), 4);
    // The street runs north of the inn, so the north edge is the front.
    let front = walls
        .iter()
        .find(|w| w.attributes["frontage"] == json!(true))
        .unwrap();
    assert_eq!(front.name.as_deref(), Some("Front wall"));
    assert_eq!(
        front.geometry,
        serde_json::from_value(json!({"type":"LineString","coordinates":[[20,16],[10,16]]}))
            .unwrap()
    );
    assert!(
        front.footprint.is_some(),
        "a wall's thickness covers ground"
    );
    let door = ground.iter().find(|f| f.kind == "door").unwrap();
    assert_eq!(door.relations[0].target_id, front.id);
    assert_eq!(door.attributes["street"], json!("Drovers' Way"));
    let marked = ground
        .iter()
        .filter(|f| f.kind == "hex" && f.attributes["marks"].get("structure").is_some())
        .count();
    assert!(marked > 10, "walls mark the hexes they cross");
}

#[test]
fn levels_are_added_and_removed_as_undoable_edits() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, "inn").unwrap();
    let outcome = edit(&store, &floors, json!({"command":"addLevel","below":false}));
    let numbers: Vec<i32> = levels(&outcome.map).into_iter().map(|(n, _)| n).collect();
    assert_eq!(numbers, vec![-1, 0, 1, 2]);
    let top = level_features(&store, &outcome.map, "surface:level:2");
    assert_eq!(
        top.iter().filter(|f| f.kind == "wall").count(),
        4,
        "outer walls carried up"
    );
    assert!(top.iter().filter(|f| f.kind == "hex").count() > 50);
    let undone = store.edits().undo(&floors).unwrap();
    assert_eq!(levels(&undone.map).len(), 3);
    assert!(undone.map.spaces.iter().all(|s| s.id != "surface:level:2"));
    assert!(undone
        .map
        .layers
        .iter()
        .all(|l| l.space_id != "surface:level:2"));
}

#[test]
fn a_removed_cellar_goes_with_what_was_drawn_in_it_and_comes_back_with_it() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, "inn").unwrap();
    let drawn = edit(
        &store,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    );
    let removed = edit(
        &store,
        &floors,
        json!({"command":"removeLevel","spaceId":"surface:level:-1"}),
    );
    assert_eq!(levels(&removed.map).len(), 2);
    assert!(removed
        .map
        .layers
        .iter()
        .all(|l| l.space_id != "surface:level:-1"));
    let back = store.edits().undo(&floors).unwrap();
    let cellar = level_features(&store, &back.map, "surface:level:-1");
    assert!(cellar.iter().any(|f| f.id == drawn.changed[0]));
    let refused: EditCommand =
        serde_json::from_value(json!({"command":"removeLevel","spaceId":SURFACE})).unwrap();
    assert!(
        store.edits().edit(&floors, &refused).is_err(),
        "the ground floor stays"
    );
}

#[test]
fn stairs_link_levels_and_a_trapdoor_reaches_a_cave_on_the_parent() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, "inn").unwrap();
    let down = edit(
        &store,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0]
        .clone();
    let up = edit(&store, &floors, trapdoor("vector:structures", [14.0, 12.0])).changed[0].clone();
    let linked =
        |target: ConnectionTarget, id: &str| json!({"command":"connect","id":id,"target":target});
    edit(
        &store,
        &floors,
        linked(
            ConnectionTarget {
                map_id: None,
                feature_id: up.clone(),
            },
            &down,
        ),
    );
    let map = store.access().open(&floors).unwrap();
    let cellar = level_features(&store, &map, "surface:level:-1");
    let hatch = cellar.iter().find(|f| f.id == down).unwrap();
    assert!(hatch
        .relations
        .iter()
        .any(|r| r.target_id == up && r.kind == "leadsTo"));
    let ground = level_features(&store, &map, SURFACE);
    assert!(ground
        .iter()
        .find(|f| f.id == up)
        .unwrap()
        .relations
        .iter()
        .any(|r| r.target_id == down));
    // A cellar trapdoor opens into the cave passage under the parent ground map.
    let cave = ConnectionTarget {
        map_id: Some("glen".into()),
        feature_id: "passage".into(),
    };
    edit(&store, &floors, linked(cave.clone(), &down));
    let cellar = level_features(&store, &map, "surface:level:-1");
    let relation = cellar
        .iter()
        .find(|f| f.id == down)
        .unwrap()
        .relations
        .iter()
        .find(|r| r.kind == "connectsTo")
        .cloned()
        .unwrap();
    assert_eq!(
        (relation.target_id.as_str(), relation.target_name.as_str()),
        ("glen#passage", "passage")
    );
    // A missing feature on the other map, or a link on the same level, is refused.
    let missing = ConnectionTarget {
        map_id: Some("glen".into()),
        feature_id: "nowhere".into(),
    };
    let command: EditCommand = serde_json::from_value(linked(missing, &down)).unwrap();
    assert!(store.edits().edit(&floors, &command).is_err());
    let flat =
        edit(&store, &floors, trapdoor("vector:structures", [16.0, 12.0])).changed[0].clone();
    let command: EditCommand = serde_json::from_value(linked(
        ConnectionTarget {
            map_id: None,
            feature_id: flat,
        },
        &up,
    ))
    .unwrap();
    assert!(store.edits().edit(&floors, &command).is_err());
    let disconnected = edit(
        &store,
        &floors,
        json!({"command":"disconnect","id":down,"target":cave}),
    );
    assert!(disconnected.changed.contains(&down));
}

#[test]
fn the_floors_show_the_magic_and_the_place_outside_them() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, "inn").unwrap();
    let call: ReadCall = serde_json::from_value(json!({"method":"site","args":[floors]})).unwrap();
    let bytes = call.execute(store.access(), &files).unwrap();
    let context: SiteContext = codec::decode(&bytes).unwrap();
    assert_eq!(context.magic.len(), 1);
    assert_eq!(
        (context.magic[0].system.as_str(), context.magic[0].share),
        ("aurora", 0.35)
    );
    assert_eq!(
        context
            .features
            .iter()
            .map(|f| f.feature_id.as_str())
            .collect::<Vec<_>>(),
        vec!["rime"]
    );
    assert_eq!(context.place.street.as_deref(), Some("Drovers' Way"));
    assert_eq!(context.place.settlement.as_deref(), Some("Glen"));
}

fn floors() -> (MapStore, MapRef, MapRef) {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, "inn").unwrap();
    (store, glen, floors)
}
fn find(store: &MapStore, reference: &MapRef, id: &str) -> Option<MapFeature> {
    let map = store.access().open(reference).unwrap();
    map.spaces
        .iter()
        .flat_map(|space| level_features(store, &map, &space.id))
        .find(|feature| feature.id == id)
}
fn links(store: &MapStore, reference: &MapRef, id: &str) -> Vec<String> {
    find(store, reference, id)
        .map(|f| f.relations.iter().map(|r| r.target_id.clone()).collect())
        .unwrap_or_default()
}
fn connect(id: &str, map_id: Option<&str>, feature_id: &str, on: bool) -> Value {
    let target = ConnectionTarget {
        map_id: map_id.map(String::from),
        feature_id: feature_id.into(),
    };
    json!({"command": if on { "connect" } else { "disconnect" }, "id": id, "target": target})
}
/// A cellar trapdoor led to by a trapdoor on the ground floor.
fn linked_pair(store: &MapStore, floors: &MapRef) -> (String, String) {
    let down = edit(
        store,
        floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0]
        .clone();
    let up = edit(store, floors, trapdoor("vector:structures", [14.0, 12.0])).changed[0].clone();
    edit(store, floors, connect(&down, None, &up, true));
    (down, up)
}

#[test]
fn deleting_a_stair_or_its_level_lets_go_of_the_landing_and_undo_restores_both() {
    let (store, _, floors) = floors();
    let (down, up) = linked_pair(&store, &floors);
    edit(&store, &floors, json!({"command":"delete","ids":[up]}));
    assert!(find(&store, &floors, &up).is_none());
    assert!(
        links(&store, &floors, &down).is_empty(),
        "the landing lets go"
    );
    store.edits().undo(&floors).unwrap();
    assert_eq!(links(&store, &floors, &down), vec![up.clone()]);
    assert_eq!(links(&store, &floors, &up), vec![down.clone()]);
    edit(
        &store,
        &floors,
        json!({"command":"removeLevel","spaceId":"surface:level:-1"}),
    );
    assert!(
        links(&store, &floors, &up).is_empty(),
        "the cellar went with its trapdoor"
    );
    store.edits().undo(&floors).unwrap();
    assert_eq!(links(&store, &floors, &up), vec![down]);
}

#[test]
fn a_link_whose_target_is_gone_can_still_be_disconnected() {
    let (store, glen, floors) = floors();
    let down = edit(
        &store,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0]
        .clone();
    edit(
        &store,
        &floors,
        connect(&down, Some("glen"), "yard-door", true),
    );
    assert_eq!(links(&store, &floors, &down), vec!["glen#yard-door"]);
    // The parent's door goes; the trapdoor still names it until it is let go of.
    edit(
        &store,
        &glen,
        json!({"command":"delete","ids":["yard-door"]}),
    );
    let refused: EditCommand =
        serde_json::from_value(connect(&down, Some("glen"), "yard-door", true)).unwrap();
    assert!(store.edits().edit(&floors, &refused).is_err());
    edit(
        &store,
        &floors,
        connect(&down, Some("glen"), "yard-door", false),
    );
    assert!(links(&store, &floors, &down).is_empty());
}

#[test]
fn a_connection_reaches_only_what_the_rule_allows_and_lists_it() {
    let (store, _, floors) = floors();
    let down = edit(
        &store,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0]
        .clone();
    let street: EditCommand =
        serde_json::from_value(connect(&down, Some("glen"), "street", true)).unwrap();
    let refused = store
        .edits()
        .edit(&floors, &street)
        .unwrap_err()
        .to_string();
    assert!(refused.contains("cannot be reached"), "{refused}");
    let call: ReadCall =
        serde_json::from_value(json!({"method":"connections","args":[floors, down]})).unwrap();
    let files = MapFiles::new(temporary("unused"));
    let listed: Vec<atlas_map::structure::ConnectionCandidate> =
        codec::decode(&call.execute(store.access(), &files).unwrap()).unwrap();
    let labels: Vec<_> = listed.iter().map(|c| c.label.as_str()).collect();
    // The passage under the inn and the yard door beside it; never the street or the inn.
    assert_eq!(
        labels,
        vec!["yard-door · Glen, surface", "passage · Glen, caves"]
    );
}

#[test]
fn a_drawn_wall_joins_an_outer_wall_and_follows_it() {
    let (store, _, floors) = floors();
    let map = store.access().open(&floors).unwrap();
    let front = level_features(&store, &map, SURFACE)
        .into_iter()
        .find(|f| f.kind == "wall" && f.attributes["frontage"] == json!(true))
        .unwrap();
    let inner = edit(
        &store,
        &floors,
        json!({"command":"create","layerId":"vector:structures","kind":"wall","name":"Kitchen wall",
            "geometry":{"type":"LineString","coordinates":[[15,13],[15,16]]},
            "attributes":{"widths":[0.2,0.2]},"creatorLayer":null}),
    )
    .changed[0]
        .clone();
    assert!(links(&store, &floors, &inner).contains(&front.id));
    edit(
        &store,
        &floors,
        json!({"command":"transform","ids":[front.id],
            "transform":{"translate":[0,1],"rotate":0,"scale":1,"about":[0,0]}}),
    );
    let moved = find(&store, &floors, &inner).unwrap();
    assert_eq!(
        moved.geometry,
        serde_json::from_value(json!({"type":"LineString","coordinates":[[15,13],[15,17]]}))
            .unwrap()
    );
}

#[test]
fn saving_the_ground_map_keeps_its_floors_and_saving_the_floors_keeps_the_ground() {
    let (mut store, glen, files, working) = published_at();
    let floors = open_floors(&mut store, &files, &glen, "inn").unwrap();
    let request = |reference: &MapRef| atlas_gis::map_store::SaveRequest {
        reference: reference.clone(),
        expected_version: None,
        navigation: Default::default(),
        settings: Default::default(),
    };
    let time = "2026-11-17T00:00:00Z".to_string();
    let saved =
        MapStore::open_database(Rc::new(Database::open(temporary("saved")).unwrap())).unwrap();
    saved
        .save_from(working.to_str().unwrap(), request(&glen), time.clone())
        .unwrap();
    assert!(
        saved.contains(&floors).unwrap(),
        "the floors are kept with the glen"
    );
    let other =
        MapStore::open_database(Rc::new(Database::open(temporary("saved")).unwrap())).unwrap();
    other
        .save_from(working.to_str().unwrap(), request(&floors), time)
        .unwrap();
    assert!(
        other.contains(&glen).unwrap(),
        "the glen is kept with its floors"
    );
}
