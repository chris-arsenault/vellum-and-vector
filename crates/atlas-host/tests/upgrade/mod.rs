use super::{feature, id, map, shape};
use atlas_gis::{map_store::codec, postgres_maps::PostgresMaps};
use atlas_host::private_inputs::PrivateInputs;
use atlas_map::{MapRef, Position};
use postgres::{Client, NoTls};
use serde_json::{json, Value};

type Result = std::result::Result<(), Box<dyn std::error::Error>>;

pub(super) fn check(admin: &mut Client, url: &str) -> Result {
    admin.batch_execute("CREATE ROLE atlas_upgrade LOGIN")?;
    admin.batch_execute("CREATE DATABASE atlas_upgrade OWNER atlas_upgrade")?;
    let url = url.replace("dbname=postgres", "dbname=atlas_upgrade");
    let mut admin = Client::connect(&url, NoTls)?;
    admin.batch_execute("CREATE EXTENSION postgis; SET ROLE atlas_upgrade")?;
    admin.batch_execute(include_str!("legacy.sql"))?;
    seed_map(&mut admin)?;
    seed_generation(&mut admin)?;
    let writer_url = url.replace("user=postgres", "user=atlas_upgrade");
    check_map(&writer_url)?;
    check_generation(&writer_url)?;
    check_journals(&mut admin)
}

fn seed_map(db: &mut Client) -> Result {
    let mut descriptor = serde_json::to_value(map("old"))?;
    descriptor["reference"] = json!({"mapId":"island","revision":"old"});
    descriptor["worldId"] = json!("world");
    descriptor["primarySpaceId"] = json!("surface");
    descriptor["spaces"][0]["id"] = json!("surface");
    descriptor["layers"][0]["spaceId"] = json!("surface");
    let mut inspection = descriptor["layers"][0].clone();
    inspection["id"] = json!("inspection");
    inspection["source"] = json!({"kind":"attributes","data":{"bands":[
        {"id":"hidden","name":"Hidden measurement","unit":"feet"}
    ]}});
    descriptor["layers"]
        .as_array_mut()
        .unwrap()
        .push(inspection);
    db.execute(
        "INSERT INTO map.revisions VALUES ('island','old',$1,NULL,true)",
        &[&descriptor],
    )?;
    db.execute("INSERT INTO map.heads VALUES ('island','old')", &[])?;
    let mut place = feature("ford", json!({"type":"Point","coordinates":[5,5]}));
    place["id"] = json!("ford");
    place["spaceId"] = json!("surface");
    place["catalog"]["columns"] = json!([{"key":"name","label":"Place name","numeric":false}]);
    place.as_object_mut().unwrap().remove("geometry");
    db.execute(
        "INSERT INTO map.features VALUES ('island','old','ford','surface','places','ford',ST_MakePoint(5,5),$1)",
        &[&place],
    )?;
    let sample = json!({
        "id":"cell","spaceId":"surface","window":{"bounds":[0,0,10,10],"closedEast":true,"closedNorth":true},
        "cellSpan":10,"center":[5,5],"measure":100,"active":true,"attributes":[[0,7]],"sections":[]
    });
    db.execute(
        "INSERT INTO map.samples VALUES ('island','old','cell','surface',ST_MakeEnvelope(0,0,10,10),$1)",
        &[&codec::encode(&sample)?],
    )?;
    db.batch_execute(
        "INSERT INTO map.history VALUES ('island','old','history',
            '{\"id\":\"history\",\"title\":\"A ford\",\"description\":\"Founded\",\"epoch\":1,\"featureIds\":[\"ford\"],\"attributes\":{}}');
         INSERT INTO map.history_features VALUES ('island','old','history','ford');
         INSERT INTO map.assets VALUES ('island','old','places','application/geo+json','places.geojson',12,false)",
    )?;
    Ok(())
}

fn seed_generation(db: &mut Client) -> Result {
    let document = json!({
        "world":{"id":"world","version":1,"areas":{"island":{"id":"island"}}},
        "scope":{"worldId":"world","areaId":"island","spaceId":"surface","footprint":shape(),
            "crsId":"planar-metres","resolution":1,"revision":1,"time":"present"},
        "coverage":[],"fieldPatches":[]
    });
    db.execute(
        "INSERT INTO generation.catalogs VALUES ('catalog',$1)",
        &[&document],
    )?;
    db.batch_execute(
        "INSERT INTO generation.inputs VALUES ('island','old','world','island',1,'catalog');
         INSERT INTO generation.records VALUES ('catalog','node','node-a',
            '{\"id\":\"node-a\",\"kind\":\"junction\",\"position\":{\"x\":5,\"y\":5,\"z\":0},\"spaceId\":\"surface\"}')",
    )?;
    Ok(())
}

fn check_map(url: &str) -> Result {
    let store = PostgresMaps::connect(url)?;
    store.initialize()?;
    store.initialize()?;
    let reference = store.find_head(id("island"))?.unwrap();
    assert_eq!(reference.revision, id("old"));
    store.open(&reference)?.require_complete()?;
    assert_eq!(
        store.asset(&reference, "places")?.location,
        "places.geojson"
    );
    let history = store.history(&reference, None, Some(&[id("ford")]))?;
    assert_eq!(history.items[0].id, id("history"));
    let samples = store.samples_at(&reference, id("surface"), Position::xy(5.0, 5.0))?;
    assert_eq!(samples[0].sections[0].records[0]["value"], 7);
    Ok(())
}

fn check_generation(url: &str) -> Result {
    let inputs = PrivateInputs::connect(url)?;
    inputs.initialize()?;
    inputs.initialize()?;
    let reference = MapRef {
        map_id: id("island"),
        revision: id("old"),
    };
    assert_eq!(inputs.read(&reference)?.world_id, id("world"));
    assert_eq!(
        inputs.document(&reference)?.scope.located.space_id,
        id("surface")
    );
    Ok(())
}

fn check_journals(db: &mut Client) -> Result {
    for table in ["map.schema_migrations", "generation.schema_migrations"] {
        let rows = db.query(&format!("SELECT version FROM {table}"), &[])?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<_, i32>(0), 1);
    }
    let row = db.query_one("SELECT kind,data FROM generation.records", &[])?;
    assert_eq!(row.get::<_, i16>(0), 1);
    let record: Value = codec::decode(row.get(1))?;
    assert_eq!(record["id"], json!(id("node-a")));
    Ok(())
}
