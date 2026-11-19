#![cfg(not(target_arch = "wasm32"))]
//! A building's floors map on a small supplied ground map: the shell from the footprint with
//! its front wall and door, levels from storeys, level commands with undo, connections to
//! another level and to a cave passage on the parent, and the outside context read from the
//! parent's published rasters.
use atlas_gis::{
    map_files::MapFiles,
    map_protocol::ReadCall,
    map_store::{codec, FeatureQuery, MapStore},
    sql::Database,
};
use atlas_host::structure_maps::open_floors;
use atlas_map::{
    authoring::EditCommand,
    structure::{level_space_id, levels, ConnectionTarget, SiteContext},
    Id, MapDescriptor, MapFeature, MapRef, PublicationBatch, Publisher,
};
use serde_json::{json, Value};
use std::{path::PathBuf, rc::Rc};
use tiff::encoder::{colortype::Gray32Float, TiffEncoder};

/// The published channel the parent's magic coverage raster layer holds.
const COVERAGE: &str = "magic:aurora:coverage";
/// The Aurora coverage the parent publishes over the whole glen.
const AURORA: f32 = 0.35;
/// Coverage raster pixels across and down the glen, each 10 m square.
const PIXELS: (u32, u32) = (4, 3);

/// A fixture's identity from its name.
fn id(name: &str) -> Id {
    Id::from_name(name)
}
fn surface() -> Id {
    id("surface")
}
/// The underground space beneath the glen's surface.
fn under() -> Id {
    Id::v5(surface(), b"underground")
}
/// The located space of the floors map's level `number`.
fn level(number: i32) -> Id {
    level_space_id(surface(), number)
}
fn layer(id: &str, space: Id, kinds: &[&str]) -> Value {
    let types: Vec<Value> = kinds
        .iter()
        .map(|kind| json!({"id":kind,"kind":kind,"label":kind,"path":[id],"magicDepiction":null,"count":0,"geometries":[],"footprints":false}))
        .collect();
    json!({"id":format!("vector:{id}"),"name":id,"spaceId":space,"bounds":[0,0,40,30],"attribution":[],
        "catalog":{"path":[id],"common":true,"featureTypes":types,"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]},
        "source":{"kind":"vector","data":{"assetId":id,"mediaType":"application/geo+json"}}})
}
/// The magic coverage channel, published as an undrawn raster layer whose `value` band holds it.
fn coverage_layer() -> Value {
    json!({"id":format!("raster:{COVERAGE}"),"name":"Aurora coverage","spaceId":surface(),"bounds":[0,0,40,30],
        "attribution":[],
        "source":{"kind":"attributes","data":{"assetId":"aurora","mediaType":"image/tiff","width":PIXELS.0,
            "height":PIXELS.1,"cellSpan":10,"overviews":[],"bandIndices":[1],
            "bands":[{"id":"value","name":"Aurora coverage","unit":"ratio",
                "display":{"unit":"ratio","factor":1.0},"nodata":null,"categories":[],"range":null}]}},
        "catalog":{"path":[],"common":false,"featureTypes":[],"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]}})
}
/// Write the coverage raster as a one-band 32-bit float TIFF holding `AURORA` everywhere.
fn write_coverage(files: &MapFiles) -> Value {
    files.ensure_directory().unwrap();
    let (width, height) = PIXELS;
    let pixels = vec![AURORA; (width * height) as usize];
    let location = "aurora.tif";
    let path = files.path(location).unwrap();
    let mut encoder = TiffEncoder::new(std::fs::File::create(&path).unwrap()).unwrap();
    encoder
        .write_image::<Gray32Float>(width, height, &pixels)
        .unwrap();
    let bytes = std::fs::metadata(&path).unwrap().len();
    json!({"id":"aurora","location":location,"mediaType":"image/tiff","byteLength":bytes,"illustration":false})
}
fn space(id: Id, parent: Option<Id>, floor: Option<&str>) -> Value {
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
        layer("roads", surface(), &["street"]),
        layer("structures", surface(), &structures),
        layer("objects", surface(), &["decor"]),
        layer("hexes", surface(), &["hex"]),
        layer("magic", surface(), &["aurora:rime"]),
        layer("caves", under(), &["dissolvedPassage"]),
    ];
    layers.push(coverage_layer());
    serde_json::from_value(json!({
        "reference":{"mapId":id("glen"),"revision":id("published")},"worldId":id("world"),"name":"Glen","parent":null,
        "state":"incomplete","profile":"local","primarySpaceId":surface(),"bounds":[0,0,40,30],
        "footprint":{"type":"Polygon","coordinates":[[[0,0],[40,0],[40,30],[0,30],[0,0]]]},
        "regionScale":{"level":0,"nextArea":25,"subdivision":7,"minimumWidth":0.01,"enabled":false},
        "spaces":[space(surface(), None, None), space(under(), Some(surface()), Some("underground"))],
        "layers":layers,
        "realScale":{"kind":"ground","hexSize":"1.5m","acrossFlats":1.5,"feet":5,"origin":[20,15],
            "trianglesPerEdge":2,"creatorLayers":[{"id":id("base"),"name":"Base layer"}],"edits":0}
    }))
    .unwrap()
}
fn feature(
    name: &str,
    space: Id,
    layer: &str,
    kind: &str,
    geometry: Value,
    attributes: Value,
) -> MapFeature {
    serde_json::from_value(json!({"id":id(name),"name":name,"spaceId":space,"layerId":format!("vector:{layer}"),"typeId":kind,
        "kind":kind,"entityId":null,"geometry":geometry,"footprint":null,"attributes":attributes,"relations":[],"causes":[],
        "catalog":{"values":{},"origin":"Generated geography","mapOnly":false}}))
    .unwrap()
}
fn sample() -> atlas_map::MapSample {
    serde_json::from_value(json!({"id":"site","spaceId":surface(),
        "footprint":{"type":"Polygon","coordinates":[[[0,0],[40,0],[40,30],[0,30],[0,0]]]},
        "window":{"bounds":[0,0,40,30],"closedEast":true,"closedNorth":true},"cellSpan":40,"center":[20,15],
        "measure":1200,"active":true,"sections":[]}))
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
    let files = MapFiles::new(temporary("assets"));
    let coverage = write_coverage(&files);
    let map = parent();
    store.begin(&map, None, false).unwrap();
    let mut inn = feature(
        "inn",
        surface(),
        "structures",
        "building",
        json!({"type":"Polygon","coordinates":[[[10,10],[20,10],[20,16],[10,16],[10,10]]]}),
        json!({"use":"inn","storeys":2,"address":"3 Drovers' Way","street":"Drovers' Way","ward":"Glenfoot","settlement":"Glen"}),
    );
    inn.name = Some("The Rowan".into());
    inn.relations = serde_json::from_value(
        json!([{"targetId":id("street"),"targetName":"Drovers' Way","kind":"fronts"}]),
    )
    .unwrap();
    let mut street = feature(
        "street",
        surface(),
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
            under(),
            "caves",
            "dissolvedPassage",
            json!({"type":"LineString","coordinates":[[12,12],[30,12]]}),
            json!({}),
        ),
        feature(
            "rime",
            surface(),
            "magic",
            "aurora:rime",
            json!({"type":"Point","coordinates":[25,18]}),
            json!({}),
        ),
        // A yard door beside the inn, on the parent's surface.
        feature(
            "yard-door",
            surface(),
            "structures",
            "door",
            json!({"type":"Polygon","coordinates":[[[21,17],[22,17],[22,18],[21,18],[21,17]]]}),
            json!({}),
        ),
    ];
    let assets = ["roads", "structures", "objects", "hexes", "magic", "caves"]
        .iter()
        .map(|id| json!({"id":id,"location":format!("{id}.geojson"),"mediaType":"application/geo+json","byteLength":10,"illustration":false}))
        .chain([coverage])
        .map(|asset| serde_json::from_value(asset).unwrap())
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
    (store, map.reference, files, path)
}
fn level_features(store: &MapStore, map: &MapDescriptor, space: Id) -> Vec<MapFeature> {
    let query = FeatureQuery {
        space_id: space,
        ..Default::default()
    };
    store
        .access()
        .features(&map.reference, &query)
        .unwrap()
        .items
}
fn edit(
    store: &MapStore,
    files: &MapFiles,
    reference: &MapRef,
    command: Value,
) -> atlas_map::authoring::EditOutcome {
    let command: EditCommand = serde_json::from_value(command).unwrap();
    store.edits().edit(reference, &command, files).unwrap()
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
    let floors = open_floors(&mut store, &files, &glen, id("inn")).unwrap();
    assert_eq!(
        open_floors(&mut store, &files, &glen, id("inn")).unwrap(),
        floors,
        "opens once"
    );
    let map = store.access().open(&floors).unwrap();
    assert_eq!(map.parent.as_ref(), Some(&glen));
    let real = map.real_scale.as_ref().unwrap();
    assert_eq!(real.site.as_ref().unwrap().building_id, id("inn"));
    assert_eq!(
        real.site.as_ref().unwrap().address.as_deref(),
        Some("3 Drovers' Way")
    );
    // Two storeys and a cellar.
    let numbers: Vec<i32> = levels(&map).into_iter().map(|(n, _)| n).collect();
    assert_eq!(numbers, vec![-1, 0, 1]);
    ground_floor_shell(&store, &map);
    let cellar = level_features(&store, &map, level(-1));
    assert_eq!(cellar.iter().filter(|f| f.kind == "wall").count(), 4);
    assert!(
        cellar.iter().all(|f| f.kind != "door"),
        "only the ground floor opens to the street"
    );
    assert!(map
        .layers
        .iter()
        .any(|l| l.id == "vector:structures@-1" && l.space_id == level(-1)));
}
/// Four outer walls, the north one the front facing the street, with the street door in it.
fn ground_floor_shell(store: &MapStore, map: &MapDescriptor) {
    let ground = level_features(store, map, surface());
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
    let floors = open_floors(&mut store, &files, &glen, id("inn")).unwrap();
    let outcome = edit(
        &store,
        &files,
        &floors,
        json!({"command":"addLevel","below":false}),
    );
    let numbers: Vec<i32> = levels(&outcome.map).into_iter().map(|(n, _)| n).collect();
    assert_eq!(numbers, vec![-1, 0, 1, 2]);
    let top = level_features(&store, &outcome.map, level(2));
    assert_eq!(
        top.iter().filter(|f| f.kind == "wall").count(),
        4,
        "outer walls carried up"
    );
    assert!(top.iter().filter(|f| f.kind == "hex").count() > 50);
    let undone = store.edits().undo(&floors).unwrap();
    assert_eq!(levels(&undone.map).len(), 3);
    assert!(undone.map.spaces.iter().all(|s| s.id != level(2)));
    assert!(undone.map.layers.iter().all(|l| l.space_id != level(2)));
}

#[test]
fn a_removed_cellar_goes_with_what_was_drawn_in_it_and_comes_back_with_it() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, id("inn")).unwrap();
    let drawn = edit(
        &store,
        &files,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    );
    let removed = edit(
        &store,
        &files,
        &floors,
        json!({"command":"removeLevel","spaceId":level(-1)}),
    );
    assert_eq!(levels(&removed.map).len(), 2);
    assert!(removed.map.layers.iter().all(|l| l.space_id != level(-1)));
    let back = store.edits().undo(&floors).unwrap();
    let cellar = level_features(&store, &back.map, level(-1));
    assert!(cellar.iter().any(|f| f.id == drawn.changed[0]));
    let refused: EditCommand =
        serde_json::from_value(json!({"command":"removeLevel","spaceId":surface()})).unwrap();
    assert!(
        store.edits().edit(&floors, &refused, &files).is_err(),
        "the ground floor stays"
    );
}

#[test]
fn stairs_link_levels_and_a_trapdoor_reaches_a_cave_on_the_parent() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, id("inn")).unwrap();
    let down = edit(
        &store,
        &files,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0];
    let up = edit(
        &store,
        &files,
        &floors,
        trapdoor("vector:structures", [14.0, 12.0]),
    )
    .changed[0];
    let linked =
        |target: ConnectionTarget, id: Id| json!({"command":"connect","id":id,"target":target});
    edit(
        &store,
        &files,
        &floors,
        linked(
            ConnectionTarget {
                map_id: None,
                feature_id: up,
            },
            down,
        ),
    );
    let map = store.access().open(&floors).unwrap();
    let cellar = level_features(&store, &map, level(-1));
    let hatch = cellar.iter().find(|f| f.id == down).unwrap();
    assert!(hatch
        .relations
        .iter()
        .any(|r| r.target_id == up && r.kind == "leadsTo"));
    let ground = level_features(&store, &map, surface());
    assert!(ground
        .iter()
        .find(|f| f.id == up)
        .unwrap()
        .relations
        .iter()
        .any(|r| r.target_id == down));
    // A cellar trapdoor opens into the cave passage under the parent ground map.
    let cave = ConnectionTarget {
        map_id: Some(id("glen")),
        feature_id: id("passage"),
    };
    edit(&store, &files, &floors, linked(cave.clone(), down));
    let cellar = level_features(&store, &map, level(-1));
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
        (
            relation.target_map_id,
            relation.target_id,
            relation.target_name.as_str()
        ),
        (Some(id("glen")), id("passage"), "passage")
    );
    // A missing feature on the other map, or a link on the same level, is refused.
    let missing = ConnectionTarget {
        map_id: Some(id("glen")),
        feature_id: id("nowhere"),
    };
    let command: EditCommand = serde_json::from_value(linked(missing, down)).unwrap();
    assert!(store.edits().edit(&floors, &command, &files).is_err());
    let flat = edit(
        &store,
        &files,
        &floors,
        trapdoor("vector:structures", [16.0, 12.0]),
    )
    .changed[0];
    let command: EditCommand = serde_json::from_value(linked(
        ConnectionTarget {
            map_id: None,
            feature_id: flat,
        },
        up,
    ))
    .unwrap();
    assert!(store.edits().edit(&floors, &command, &files).is_err());
    let disconnected = edit(
        &store,
        &files,
        &floors,
        json!({"command":"disconnect","id":down,"target":cave}),
    );
    assert!(disconnected.changed.contains(&down));
}

#[test]
fn the_floors_show_the_magic_and_the_place_outside_them() {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, id("inn")).unwrap();
    let call: ReadCall = serde_json::from_value(json!({"method":"site","args":[floors]})).unwrap();
    let bytes = call.execute(store.access(), &files).unwrap();
    let context: SiteContext = codec::decode(&bytes).unwrap();
    assert_eq!(context.magic.len(), 1);
    // Published rasters hold 32-bit floats; the share is the mean of the values read.
    assert_eq!(
        (context.magic[0].system.as_str(), context.magic[0].share),
        ("aurora", f64::from(AURORA))
    );
    assert_eq!(
        context
            .features
            .iter()
            .map(|f| f.feature_id)
            .collect::<Vec<_>>(),
        vec![id("rime")]
    );
    assert_eq!(context.place.street.as_deref(), Some("Drovers' Way"));
    assert_eq!(context.place.settlement.as_deref(), Some("Glen"));
}

fn floors() -> (MapStore, MapRef, MapRef, MapFiles) {
    let (mut store, glen, files) = published();
    let floors = open_floors(&mut store, &files, &glen, id("inn")).unwrap();
    (store, glen, floors, files)
}
fn find(store: &MapStore, reference: &MapRef, feature: Id) -> Option<MapFeature> {
    let map = store.access().open(reference).unwrap();
    map.spaces
        .iter()
        .flat_map(|space| level_features(store, &map, space.id))
        .find(|found| found.id == feature)
}
fn links(store: &MapStore, reference: &MapRef, feature: Id) -> Vec<Id> {
    find(store, reference, feature)
        .map(|f| f.relations.iter().map(|r| r.target_id).collect())
        .unwrap_or_default()
}
fn connect(source: Id, map_id: Option<Id>, feature_id: Id, on: bool) -> Value {
    let target = ConnectionTarget { map_id, feature_id };
    json!({"command": if on { "connect" } else { "disconnect" }, "id": source, "target": target})
}
/// A cellar trapdoor led to by a trapdoor on the ground floor.
fn linked_pair(store: &MapStore, files: &MapFiles, floors: &MapRef) -> (Id, Id) {
    let down = edit(
        store,
        files,
        floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0];
    let up = edit(
        store,
        files,
        floors,
        trapdoor("vector:structures", [14.0, 12.0]),
    )
    .changed[0];
    edit(store, files, floors, connect(down, None, up, true));
    (down, up)
}

#[test]
fn deleting_a_stair_or_its_level_lets_go_of_the_landing_and_undo_restores_both() {
    let (store, _, floors, files) = floors();
    let (down, up) = linked_pair(&store, &files, &floors);
    edit(
        &store,
        &files,
        &floors,
        json!({"command":"delete","ids":[up]}),
    );
    assert!(find(&store, &floors, up).is_none());
    assert!(
        links(&store, &floors, down).is_empty(),
        "the landing lets go"
    );
    store.edits().undo(&floors).unwrap();
    assert_eq!(links(&store, &floors, down), vec![up]);
    assert_eq!(links(&store, &floors, up), vec![down]);
    edit(
        &store,
        &files,
        &floors,
        json!({"command":"removeLevel","spaceId":level(-1)}),
    );
    assert!(
        links(&store, &floors, up).is_empty(),
        "the cellar went with its trapdoor"
    );
    store.edits().undo(&floors).unwrap();
    assert_eq!(links(&store, &floors, up), vec![down]);
}

#[test]
fn a_link_whose_target_is_gone_can_still_be_disconnected() {
    let (store, glen, floors, files) = floors();
    let down = edit(
        &store,
        &files,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0];
    let (glen_id, yard_door) = (Some(id("glen")), id("yard-door"));
    edit(
        &store,
        &files,
        &floors,
        connect(down, glen_id, yard_door, true),
    );
    let targets: Vec<_> = find(&store, &floors, down)
        .unwrap()
        .relations
        .iter()
        .map(|r| (r.target_map_id, r.target_id))
        .collect();
    assert_eq!(targets, vec![(glen_id, yard_door)]);
    // The parent's door goes; the trapdoor still names it until it is let go of.
    edit(
        &store,
        &files,
        &glen,
        json!({"command":"delete","ids":[yard_door]}),
    );
    let refused: EditCommand =
        serde_json::from_value(connect(down, glen_id, yard_door, true)).unwrap();
    assert!(store.edits().edit(&floors, &refused, &files).is_err());
    edit(
        &store,
        &files,
        &floors,
        connect(down, glen_id, yard_door, false),
    );
    assert!(links(&store, &floors, down).is_empty());
}

#[test]
fn a_connection_reaches_only_what_the_rule_allows_and_lists_it() {
    let (store, _, floors, files) = floors();
    let down = edit(
        &store,
        &files,
        &floors,
        trapdoor("vector:structures@-1", [14.0, 12.0]),
    )
    .changed[0];
    let street: EditCommand =
        serde_json::from_value(connect(down, Some(id("glen")), id("street"), true)).unwrap();
    let refused = store
        .edits()
        .edit(&floors, &street, &files)
        .unwrap_err()
        .to_string();
    assert!(refused.contains("cannot be reached"), "{refused}");
    let call: ReadCall =
        serde_json::from_value(json!({"method":"connections","args":[floors, down]})).unwrap();
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
    let (store, _, floors, files) = floors();
    let map = store.access().open(&floors).unwrap();
    let front = level_features(&store, &map, surface())
        .into_iter()
        .find(|f| f.kind == "wall" && f.attributes["frontage"] == json!(true))
        .unwrap();
    let inner = edit(
        &store,
        &files,
        &floors,
        json!({"command":"create","layerId":"vector:structures","kind":"wall","name":"Kitchen wall",
            "geometry":{"type":"LineString","coordinates":[[15,13],[15,16]]},
            "attributes":{"widths":[0.2,0.2]},"creatorLayer":null}),
    )
    .changed[0];
    assert!(links(&store, &floors, inner).contains(&front.id));
    edit(
        &store,
        &files,
        &floors,
        json!({"command":"transform","ids":[front.id],
            "transform":{"translate":[0,1],"rotate":0,"scale":1,"about":[0,0]}}),
    );
    let moved = find(&store, &floors, inner).unwrap();
    assert_eq!(
        moved.geometry,
        serde_json::from_value(json!({"type":"LineString","coordinates":[[15,13],[15,17]]}))
            .unwrap()
    );
}

#[test]
fn saving_the_ground_map_keeps_its_floors_and_saving_the_floors_keeps_the_ground() {
    let (mut store, glen, files, working) = published_at();
    let floors = open_floors(&mut store, &files, &glen, id("inn")).unwrap();
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
