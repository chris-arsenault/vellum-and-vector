#![cfg(not(target_arch = "wasm32"))]
//! Town tools on a small supplied village: a lane drawn off a street joins it at a new vertex
//! and is named; a placed building fronts its street on a plot and takes its address; moves,
//! deletes and inserts renumber the streets they touch; addresses are found by number and
//! street. Every map here is written by hand; nothing is generated.
use atlas_gis::{
    authoring::TownNames,
    geometry::NativeGeos,
    map_files::MapFiles,
    map_protocol::ReadCall,
    map_store::{FeatureQuery, MapStore},
    sql::Database,
};
use atlas_map::{
    authoring::{insert_junction, renumber, street_of, EditCommand, EditOutcome, Transform},
    spatial::SpatialKernel,
    town::AddressMatch,
    Geometry, Id, MapDescriptor, MapFeature, MapRef, Position, PublicationBatch, Publisher,
};
use serde_json::{json, Value};
use std::{io, path::PathBuf, rc::Rc};

/// A fixture's identity from its name.
fn id(name: &str) -> Id {
    Id::from_name(name)
}

const LAYERS: [(&str, &str, &[&str]); 6] = [
    ("rivers", "Rivers", &["stream"]),
    ("lakes", "Lakes", &["lake"]),
    ("roads", "Roads", &["street", "trail"]),
    ("structures", "Structures", &["building", "bridge"]),
    ("plots", "Plots", &["yard"]),
    ("settlements", "Settlements", &["settlement"]),
];
struct Fixed;
impl TownNames for Fixed {
    fn work(&self, culture: Option<&str>, work: &str, _: &str) -> io::Result<String> {
        assert_eq!(culture, Some("marches"));
        Ok(match work {
            "lane" => "Tanner Wynd",
            "inn" => "Crossways Inn",
            _ => "Anvil Smithy",
        }
        .into())
    }
}

fn layer(id: &str, name: &str, kinds: &[&str]) -> Value {
    let types: Vec<Value> = kinds
        .iter()
        .map(|kind| json!({"id":kind,"kind":kind,"label":kind,"path":[name],"magicDepiction":null,"count":0,"geometries":[],"footprints":false}))
        .collect();
    json!({"id":format!("vector:{id}"),"name":name,"spaceId":self::id("surface"),"bounds":[0,0,100,80],"attribution":[],
        "catalog":{"path":[name],"common":true,"featureTypes":types,"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]},
        "source":{"kind":"vector","data":{"assetId":id,"mediaType":"application/geo+json"}}})
}
fn descriptor() -> MapDescriptor {
    let layers: Vec<Value> = LAYERS
        .iter()
        .map(|(id, name, kinds)| layer(id, name, kinds))
        .collect();
    serde_json::from_value(json!({
        "reference":{"mapId":id("village"),"revision":id("published")},"worldId":id("world"),"name":"Elder Cross","parent":null,
        "state":"incomplete","profile":"local","primarySpaceId":id("surface"),"bounds":[0,0,100,80],
        "footprint":{"type":"Polygon","coordinates":[[[0,0],[100,0],[100,80],[0,80],[0,0]]]},
        "regionScale":{"level":0,"nextArea":25,"subdivision":7,"minimumWidth":0.01,"enabled":false},
        "spaces":[{"id":id("surface"),"parentSpaceId":null,"bounds":[0,0,100,80],"metresPerUnit":1,"precision":0.000001,"periodicWidth":null,"frame":{"origin":[0,0,0],"rotation":0,"floor":null}}],
        "layers":layers,
        "realScale":{"kind":"ground","hexSize":"3m","acrossFlats":3,"feet":10,"origin":[50,40],
            "trianglesPerEdge":2,"creatorLayers":[{"id":id("base"),"name":"Base layer"}],"edits":0}
    }))
    .unwrap()
}
fn feature(name: &str, layer: &str, kind: &str, geometry: Value, attributes: Value) -> MapFeature {
    serde_json::from_value(json!({"id":id(name),"name":name,"spaceId":id("surface"),"layerId":format!("vector:{layer}"),"typeId":kind,"kind":kind,
        "entityId":null,"geometry":geometry,"footprint":null,"attributes":attributes,"relations":[],"causes":[],
        "catalog":{"values":{},"origin":"Generated geography","mapOnly":false}}))
    .unwrap()
}
fn rectangle(w: f64, s: f64, e: f64, n: f64) -> Value {
    json!({"type":"Polygon","coordinates":[[[w,s],[e,s],[e,n],[w,n],[w,s]]]})
}
fn address(number: u32, street: &str) -> Value {
    json!({"address":format!("{number} {street}"),"addressNumber":number,"street":street,"settlement":"Elder Cross"})
}
/// The relation by which a building or plot fronts High Street.
fn fronts_high_street() -> Vec<atlas_map::MapRelation> {
    serde_json::from_value(json!([{"kind":"fronts","targetId":id("high-street"),
        "targetMapId":null,"targetName":"High Street"}]))
    .unwrap()
}
/// A house and its plot on High Street, 12 m of frontage, north or south of the street.
fn house(id: &str, x: f64, north: bool, number: u32) -> Vec<MapFeature> {
    let (near, far): (f64, f64) = if north { (43.5, 63.5) } else { (36.5, 16.5) };
    let (inner, outer): (f64, f64) = if north { (45.5, 52.5) } else { (34.5, 27.5) };
    let mut yard = feature(
        &format!("{id}-yard"),
        "plots",
        "yard",
        rectangle(x - 6.0, near.min(far), x + 6.0, near.max(far)),
        address(number, "High Street"),
    );
    yard.name = Some(format!("{number} High Street"));
    yard.attributes.insert("nameStatus".into(), "label".into());
    yard.relations = fronts_high_street();
    let mut attributes = address(number, "High Street");
    attributes["use"] = "house".into();
    attributes["occupants"] = 5.into();
    attributes["household"] = format!("{id} Household").into();
    let mut building = feature(
        id,
        "structures",
        "building",
        rectangle(x - 4.0, inner.min(outer), x + 4.0, inner.max(outer)),
        attributes,
    );
    building.relations = fronts_high_street();
    vec![yard, building]
}
fn village() -> Vec<MapFeature> {
    let street = |id: &str, name: &str, class: &str, points: Value, width: f64| {
        let count = points.as_array().unwrap().len();
        let mut street = feature(
            id,
            "roads",
            "street",
            json!({"type":"LineString","coordinates":points}),
            json!({"widths":vec![width; count],"roadClass":class,"settlement":"Elder Cross"}),
        );
        street.name = Some(name.into());
        street
    };
    let mut place = feature(
        "elder-cross",
        "settlements",
        "settlement",
        json!({"type":"Point","coordinates":[20,40]}),
        json!({"settlementPopulation":300,"namingCulture":"marches"}),
    );
    place.name = Some("Elder Cross".into());
    let mut site = feature(
        "inn-site",
        "plots",
        "yard",
        rectangle(39.0, 16.5, 51.0, 36.5),
        json!({}),
    );
    site.name = Some("Inn site".into());
    let mut all = vec![
        place,
        street(
            "high-street",
            "High Street",
            "mainStreet",
            json!([[20, 40], [50, 40], [90, 40]]),
            6.0,
        ),
        street(
            "mill-lane",
            "Mill Lane",
            "lane",
            json!([[20, 40], [20, 75]]),
            3.5,
        ),
        street(
            "north-row",
            "North Row",
            "lane",
            json!([[60, 76], [95, 76]]),
            3.5,
        ),
        site,
        feature(
            "mill-burn",
            "rivers",
            "stream",
            json!({"type":"LineString","coordinates":[[85, 0], [85, 30]]}),
            json!({"widths":[4.0, 4.0]}),
        ),
        feature(
            "mill-pond",
            "lakes",
            "lake",
            rectangle(2.0, 2.0, 40.0, 12.0),
            json!({}),
        ),
    ];
    for (id, x, north, number) in [
        ("house-1", 30.0, true, 1),
        ("house-3", 45.0, true, 3),
        ("house-2", 30.0, false, 2),
        ("house-4", 60.0, false, 4),
    ] {
        all.extend(house(id, x, north, number));
    }
    all
}
fn publish() -> io::Result<(MapStore, MapRef, PathBuf)> {
    let path = std::env::temp_dir().join(format!("atlas-town-{}.sqlite", uuid::Uuid::new_v4()));
    let mut store = MapStore::open_database(Rc::new(Database::open(&path)?))?;
    let map = descriptor();
    store.begin(&map, None, false)?;
    let assets = LAYERS
        .iter()
        .map(|(id, ..)| serde_json::from_value(json!({"id":id,"location":format!("{id}.geojson"),"mediaType":"application/geo+json","byteLength":10,"illustration":false})).unwrap())
        .collect();
    store.append(
        &map.reference,
        PublicationBatch {
            features: village(),
            assets,
            ..Default::default()
        },
    )?;
    store.finish(&map.reference)?;
    Ok((store, map.reference, path))
}
fn read(store: &MapStore, reference: &MapRef, feature: Id) -> Option<MapFeature> {
    let query = FeatureQuery {
        space_id: id("surface"),
        feature_ids: Some(vec![feature]),
        ..Default::default()
    };
    store.features(reference, &query).unwrap().items.pop()
}
/// The address number of a fixture feature, by its name.
fn number(store: &MapStore, reference: &MapRef, name: &str) -> Option<u64> {
    read(store, reference, id(name))?
        .attributes
        .get("addressNumber")?
        .as_u64()
}
fn text(feature: &MapFeature, key: &str) -> String {
    feature.attributes[key]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}
fn points(feature: &MapFeature) -> Vec<[f64; 2]> {
    let Geometry::LineString { coordinates } = &feature.geometry else {
        panic!("expected a line")
    };
    coordinates
        .iter()
        .map(|p| [p.coordinates()[0], p.coordinates()[1]])
        .collect()
}
fn edit(store: &MapStore, reference: &MapRef, command: EditCommand) -> io::Result<EditOutcome> {
    // The village has no rasters.
    let files = MapFiles::new(std::env::temp_dir());
    store
        .edits()
        .edit_named(reference, &command, &files, &Fixed)
}
fn place(
    store: &MapStore,
    reference: &MapRef,
    use_: &str,
    at: [f64; 2],
) -> io::Result<EditOutcome> {
    edit(
        store,
        reference,
        EditCommand::PlaceBuilding {
            building_use: use_.into(),
            at,
            name: None,
            creator_layer: None,
        },
    )
}

#[test]
fn a_junction_puts_a_vertex_on_the_way_with_its_width_there() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let mut way = feature(
        "way",
        "roads",
        "street",
        json!({"type":"LineString","coordinates":[[0,0],[10,0],[30,0]]}),
        json!({"widths":[4.0,6.0,2.0]}),
    );
    let (joined, at) = insert_junction(&way, 0.5, &spatial).unwrap();
    assert_eq!(
        points(&joined),
        [[0.0, 0.0], [10.0, 0.0], [15.0, 0.0], [30.0, 0.0]]
    );
    assert_eq!(joined.attributes["widths"], json!([4.0, 6.0, 5.0, 2.0]));
    assert_eq!(at.coordinates()[0], 15.0);
    way.attributes.remove("widths");
    let (same, at) = insert_junction(&way, 10.0 / 30.0, &spatial).unwrap();
    assert_eq!(points(&same).len(), 3);
    assert_eq!(at, Position::xy(10.0, 0.0));
}
#[test]
fn numbers_follow_the_street_from_its_first_point_odd_left_even_right() {
    let spatial = NativeGeos::new(1e-9).unwrap();
    let street = feature(
        "s",
        "roads",
        "street",
        json!({"type":"LineString","coordinates":[[0,0],[100,0]]}),
        json!({}),
    );
    let at = |x: f64, y: f64| Position::xy(x, y);
    let numbers = renumber(
        &street,
        &[at(40.0, 5.0), at(10.0, 5.0), at(20.0, -5.0), at(60.0, -5.0)],
        &[None; 4],
        &spatial,
    )
    .unwrap();
    assert_eq!(numbers, [3, 1, 2, 4]);
    let inserted = renumber(
        &street,
        &[
            at(40.0, 5.0),
            at(10.0, 5.0),
            at(20.0, -5.0),
            at(60.0, -5.0),
            at(30.0, -5.0),
        ],
        &[None; 5],
        &spatial,
    )
    .unwrap();
    assert_eq!(inserted, [3, 1, 2, 6, 4]);
}
fn lane_joins_high_street(lane: &MapFeature) {
    assert_eq!(lane.name.as_deref(), Some("Tanner Wynd"));
    assert_eq!(
        points(lane),
        [[75.0, 40.0], [75.0, 10.0]],
        "a side street begins at its junction"
    );
    assert_eq!(lane.attributes["widths"], json!([3.5, 3.5]));
    assert_eq!(
        (text(lane, "roadClass"), text(lane, "settlement")),
        ("lane".into(), "Elder Cross".into())
    );
    assert!(lane
        .relations
        .iter()
        .any(|r| r.target_id == id("high-street") && r.kind == "joins"));
}
fn an_inn_fronting_high_street(inn: &MapFeature) {
    assert_eq!(text(inn, "address"), "4 High Street");
    assert_eq!(
        (text(inn, "use"), text(inn, "business")),
        ("inn".into(), "Crossways Inn".into())
    );
    assert_eq!(
        (
            inn.attributes["occupants"].clone(),
            inn.attributes["storeys"].clone()
        ),
        (json!(5), json!(1))
    );
    assert!(inn
        .relations
        .iter()
        .any(|r| r.target_id == id("high-street") && r.kind == "fronts"));
}
#[test]
fn a_lane_drawn_off_a_street_joins_it_takes_its_class_width_and_a_name() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    let drawn = json!({"type":"LineString","coordinates":[[75,10],[75,38.5]]});
    let outcome = edit(
        &store,
        &reference,
        EditCommand::DrawStreet {
            road_class: "lane".into(),
            geometry: serde_json::from_value(drawn).unwrap(),
            name: None,
            creator_layer: None,
        },
    )?;
    assert_eq!(
        outcome.history.steps.last().unwrap().label,
        "Draw Tanner Wynd"
    );
    lane_joins_high_street(&read(&store, &reference, outcome.created[0]).unwrap());
    let high = read(&store, &reference, id("high-street")).unwrap();
    assert_eq!(
        points(&high),
        [[20.0, 40.0], [50.0, 40.0], [75.0, 40.0], [90.0, 40.0]]
    );
    assert_eq!(high.attributes["widths"], json!([6.0, 6.0, 6.0, 6.0]));
    store.edits().undo(&reference)?;
    assert!(read(&store, &reference, outcome.created[0]).is_none());
    assert_eq!(
        points(&read(&store, &reference, id("high-street")).unwrap()).len(),
        3
    );
    Ok(())
}
#[test]
fn an_inn_placed_on_an_empty_plot_takes_its_address_and_renumbers_its_side() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    let outcome = place(&store, &reference, "inn", [45.0, 25.0])?;
    assert_eq!(
        outcome.history.steps.last().unwrap().label,
        "Place Crossways Inn"
    );
    assert_eq!(
        outcome.created.len(),
        1,
        "the empty plot is used, not a new one"
    );
    an_inn_fronting_high_street(&read(&store, &reference, outcome.created[0]).unwrap());
    assert_eq!(
        text(
            &read(&store, &reference, id("inn-site")).unwrap(),
            "address"
        ),
        "4 High Street"
    );
    assert_eq!(number(&store, &reference, "house-4"), Some(6));
    assert_eq!(number(&store, &reference, "house-4-yard"), Some(6));
    assert_eq!(number(&store, &reference, "house-2"), Some(2));
    store.edits().undo(&reference)?;
    assert_eq!(number(&store, &reference, "house-4"), Some(4));
    assert!(read(&store, &reference, outcome.created[0]).is_none());
    Ok(())
}
#[test]
fn a_building_placed_beside_a_street_stands_turned_to_it_on_a_plot_of_its_own() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    let spatial = NativeGeos::new(1e-9).unwrap();
    let outcome = place(&store, &reference, "smithy", [12.0, 60.0])?;
    let [building, plot] = [0, 1].map(|i| read(&store, &reference, outcome.created[i]).unwrap());
    assert_eq!(text(&building, "address"), "1 Mill Lane");
    assert_eq!(plot.name.as_deref(), Some("1 Mill Lane"));
    assert_eq!(building.attributes["rotation"], json!(90.0));
    // A village smithy is 10 by 9 m, narrowed to the 70% of its 14 m plot a building fills.
    assert!((spatial.area(&building.geometry).unwrap() - 9.8 * 9.0).abs() < 1e-6);
    // The 30 m deep plot ends at the map's west edge, 17.75 m from the lane's verge.
    assert!((spatial.area(&plot.geometry).unwrap() - 14.0 * 17.75).abs() < 1e-6);
    let lane = read(&store, &reference, id("mill-lane")).unwrap();
    let front = spatial
        .distance(&building.geometry, &lane.geometry)
        .unwrap();
    assert!(
        (front - (1.75 + 0.5 + 2.0)).abs() < 1e-6,
        "the smithy fronts the lane {front} m off its line"
    );
    let taken = place(&store, &reference, "house", [30.0, 49.0]);
    assert!(taken.unwrap_err().to_string().contains("would stand on"));
    Ok(())
}
#[test]
fn moving_a_building_to_another_street_readdresses_it() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    edit(
        &store,
        &reference,
        EditCommand::Transform {
            ids: vec![id("house-3")],
            transform: Transform {
                translate: [-35.0, 15.0],
                rotate: 0.0,
                scale: 1.0,
                about: [0.0, 0.0],
            },
        },
    )?;
    let moved = read(&store, &reference, id("house-3")).unwrap();
    assert_eq!(text(&moved, "address"), "1 Mill Lane");
    assert!(moved
        .relations
        .iter()
        .any(|r| r.target_id == id("mill-lane") && r.kind == "fronts"));
    assert_eq!(
        number(&store, &reference, "house-3-yard"),
        Some(3),
        "the plot keeps its number"
    );
    Ok(())
}
#[test]
fn deleting_a_plot_and_its_house_renumbers_the_houses_beyond_it() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    edit(
        &store,
        &reference,
        EditCommand::Delete {
            ids: vec![id("house-2"), id("house-2-yard")],
        },
    )?;
    assert_eq!(number(&store, &reference, "house-4"), Some(2));
    assert_eq!(
        read(&store, &reference, id("house-4-yard"))
            .unwrap()
            .name
            .as_deref(),
        Some("2 High Street")
    );
    assert_eq!(number(&store, &reference, "house-1"), Some(1));
    Ok(())
}
#[test]
fn addresses_are_found_by_number_and_street_or_by_street_alone() -> io::Result<()> {
    let (store, reference, path) = publish()?;
    let files = MapFiles::new(path.with_extension("absent-assets"));
    let find = |text: &str| -> Vec<AddressMatch> {
        let bytes = ReadCall::FindAddress(reference.clone(), text.into())
            .execute(store.access(), &files)
            .unwrap();
        ciborium::from_reader(bytes.as_slice()).unwrap()
    };
    let found = find("4 high street");
    assert_eq!(
        found.iter().map(|m| m.feature_id).collect::<Vec<_>>(),
        [id("house-4")]
    );
    assert_eq!(found[0].address, "4 High Street");
    let street = find("Mill Lane");
    assert_eq!((street.len(), street[0].feature_id), (1, id("mill-lane")));
    assert!(find("9 High Street").is_empty());
    assert_eq!(find("High")[0].feature_id, id("high-street"));
    Ok(())
}
#[test]
fn feature_type_queries_intersect_selected_layers() -> io::Result<()> {
    let (store, reference, _path) = publish()?;
    let read = |types: &[&str]| {
        store.features(
            &reference,
            &FeatureQuery {
                space_id: id("surface"),
                layer_ids: Some(vec!["vector:roads".into()]),
                type_ids: Some(types.iter().map(|id| (*id).into()).collect()),
                ..Default::default()
            },
        )
    };
    let selected = read(&["street", "building"])?.items;
    assert_eq!(selected.len(), 3);
    assert!(selected.iter().all(|record| record.kind == "street"));
    assert!(read(&["building"])?.items.is_empty());
    assert!(read(&[])?.items.is_empty());
    Ok(())
}
#[test]
fn a_new_plot_records_the_street_it_fronts_and_its_building_is_addressed_there() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    // The plot's middle lies nearer North Row behind it than High Street in front.
    let outcome = place(&store, &reference, "smithy", [70.0, 47.0])?;
    let [building, plot] = [0, 1].map(|i| read(&store, &reference, outcome.created[i]).unwrap());
    assert_eq!(street_of(&plot), Some(id("high-street")));
    assert_eq!(text(&building, "address"), "5 High Street");
    assert_eq!(text(&plot, "address"), "5 High Street");
    Ok(())
}
#[test]
fn a_building_on_an_existing_plot_is_fitted_to_that_plot() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    let spatial = NativeGeos::new(1e-9).unwrap();
    let outcome = place(&store, &reference, "inn", [45.0, 25.0])?;
    let inn = read(&store, &reference, outcome.created[0]).unwrap();
    // A 12 m by 20 m plot: a village building fills 70% of its frontage and 80% of its depth.
    let area = spatial.area(&inn.geometry).unwrap();
    assert!((area - 12.0 * 0.7 * 12.0).abs() < 1e-6, "{area}");
    let site = read(&store, &reference, id("inn-site")).unwrap();
    let inside = spatial
        .relation(
            &site.geometry,
            &inn.geometry,
            atlas_map::spatial::Predicate::Covers,
        )
        .unwrap();
    assert!(inside, "the inn stands within its plot");
    Ok(())
}
#[test]
fn buildings_keep_off_water_and_ways_when_placed_or_moved() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    let wet = place(&store, &reference, "house", [86.0, 20.0]).unwrap_err();
    assert!(wet.to_string().contains("water of mill-burn"), "{wet}");
    // 2.5 m onto the street while its centre stays in its own plot, so the way is the only
    // ground it would stand on.
    let onto_the_street = edit(
        &store,
        &reference,
        EditCommand::Transform {
            ids: vec![id("house-1")],
            transform: Transform {
                translate: [0.0, -5.0],
                rotate: 0.0,
                scale: 1.0,
                about: [0.0, 0.0],
            },
        },
    )
    .unwrap_err();
    assert!(
        onto_the_street
            .to_string()
            .contains("the way of High Street"),
        "{onto_the_street}"
    );
    assert_eq!(number(&store, &reference, "house-1"), Some(1));
    Ok(())
}
fn draw(store: &MapStore, reference: &MapRef, line: Value) -> io::Result<EditOutcome> {
    edit(
        store,
        reference,
        EditCommand::DrawStreet {
            road_class: "lane".into(),
            geometry: serde_json::from_value(json!({"type":"LineString","coordinates":line}))
                .unwrap(),
            name: Some("Burn Lane".into()),
            creator_layer: None,
        },
    )
}
#[test]
fn a_street_bridges_narrow_water_and_refuses_wide_water_and_buildings() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    let outcome = draw(&store, &reference, json!([[80, 38.5], [92, 5]]))?;
    let bridge = outcome
        .created
        .iter()
        .filter_map(|&made| read(&store, &reference, made))
        .find(|f| f.kind == "bridge")
        .expect("a bridge over Mill burn");
    let mut kinds: Vec<_> = bridge.relations.iter().map(|r| r.kind.as_str()).collect();
    kinds.sort_unstable();
    assert_eq!(kinds, ["carries", "spans"]);
    let wide = draw(&store, &reference, json!([[1, 7], [45, 7]])).unwrap_err();
    assert!(wide.to_string().contains("too wide"), "{wide}");
    let through = draw(&store, &reference, json!([[30, 20], [30, 38.5]])).unwrap_err();
    assert!(
        through.to_string().contains("run through house-2"),
        "{through}"
    );
    Ok(())
}
#[test]
fn renumbering_keeps_a_locked_plots_number_and_numbers_the_rest_around_it() -> io::Result<()> {
    let (store, reference, _) = publish()?;
    let added = edit(
        &store,
        &reference,
        EditCommand::AddLayer {
            name: "Held".into(),
        },
    )?;
    let layer = added.map.real_scale.unwrap().creator_layers[1].id;
    edit(
        &store,
        &reference,
        EditCommand::MoveToLayer {
            ids: vec![id("house-4"), id("house-4-yard")],
            layer,
        },
    )?;
    edit(
        &store,
        &reference,
        EditCommand::LockLayer {
            id: layer,
            locked: true,
        },
    )?;
    let outcome = place(&store, &reference, "inn", [45.0, 25.0])?;
    let inn = read(&store, &reference, outcome.created[0]).unwrap();
    assert_eq!(number(&store, &reference, "house-4"), Some(4));
    assert_eq!(text(&inn, "address"), "6 High Street");
    assert_eq!(number(&store, &reference, "house-2"), Some(2));
    Ok(())
}
