#![cfg(all(not(target_arch = "wasm32"), feature = "integration-tests"))]
//! Ports the existing TypeScript PostGIS publication and reader-permission cases.
use atlas_gis::{
    map_store::{FeatureQuery, SaveRequest},
    postgres_maps::PostgresMaps,
};
use atlas_host::private_inputs::PrivateInputs;
use atlas_map::{MapDescriptor, MapRef, PublicationBatch, Publisher};
use serde_json::{json, Value};
use std::io;
use testcontainers::{
    core::{IntoContainerPort, WaitFor},
    runners::SyncRunner,
    GenericImage, ImageExt,
};

fn map(revision: &str) -> MapDescriptor {
    serde_json::from_value(json!({
        "reference":{"mapId":"island","revision":revision},"worldId":"world","name":"Island","parent":null,"state":"incomplete",
        "profile":"world","primarySpaceId":"surface","footprint":shape(),"bounds":[0,0,10,10],
        "regionScale":{"level":0,"nextArea":25,"subdivision":7,"minimumWidth":0.01,"enabled":true},
        "spaces":[{"id":"surface","parentSpaceId":null,"bounds":[0,0,10,10],"metresPerUnit":1,"precision":0.000001,"periodicWidth":null,"frame":{"origin":[0,0,0],"rotation":0,"floor":null}}],
        "layers":[{"id":"places","name":"Places","spaceId":"surface","bounds":[0,0,10,10],"attribution":[],
            "catalog":{"path":["Places"],"common":true,"featureTypes":[{"id":"place","kind":"place","label":"Places","path":["Places"],"magicDepiction":null,"count":0,"geometries":[],"footprints":false}],"defaultStyle":null,"presets":[],"properties":{},"examples":[],"geometries":[]},
            "source":{"kind":"vector","data":{"assetId":"places","mediaType":"application/geo+json"}}}]
    })).unwrap()
}
fn shape() -> Value {
    json!({"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]})
}
fn feature(id: &str, geometry: Value) -> Value {
    json!({"id":id,"name":id,"spaceId":"surface","layerId":"places","typeId":"place","kind":"place","entityId":null,"geometry":geometry,"footprint":null,"attributes":{},"relations":[],"causes":[],"catalog":{"values":{},"columns":[],"origin":"Generated geography","mapOnly":false}})
}
fn assets() -> PublicationBatch {
    serde_json::from_value(json!({"assets":[{"id":"places","location":"places.geojson","mediaType":"application/geo+json","byteLength":100,"illustration":false}]})).unwrap()
}
fn complete(
    store: &mut PostgresMaps,
    revision: &str,
    expected: Option<&MapRef>,
) -> io::Result<MapRef> {
    let map = map(revision);
    store.begin(&map, expected, expected.is_none())?;
    store.append(&map.reference, assets())?;
    store.finish(&map.reference)?;
    Ok(map.reference)
}
#[test]
fn postgis_publication_queries_saves_and_reader_boundary() -> Result<(), Box<dyn std::error::Error>>
{
    let container = GenericImage::new("postgis/postgis", "16-3.5")
        .with_exposed_port(5432.tcp())
        .with_wait_for(WaitFor::message_on_stderr(
            "database system is ready to accept connections",
        ))
        .with_env_var("POSTGRES_HOST_AUTH_METHOD", "trust")
        .start()?;
    let url = format!(
        "host={} port={} user=postgres dbname=postgres",
        container.get_host()?,
        container.get_host_port_ipv4(5432)?
    );
    let mut admin = postgres::Client::connect(&url, postgres::NoTls)?;
    let mut store = PostgresMaps::connect(&url)?;
    store.initialize()?;
    PrivateInputs::connect(&url)?.initialize()?;
    let original = complete(&mut store, "original", None)?;
    replacement(&mut store, &original)?;
    scoped_queries(&mut store)?;
    saves(&store)?;
    interrupted(&mut store)?;
    admin.batch_execute("CREATE ROLE atlas_reader LOGIN")?;
    store.grant_reader("atlas_reader")?;
    let reader_url = url.replace("user=postgres", "user=atlas_reader");
    let reader = PostgresMaps::connect(&reader_url)?;
    assert!(reader.find_head("island")?.is_some());
    let mut restricted = postgres::Client::connect(&reader_url, postgres::NoTls)?;
    assert!(restricted
        .query("SELECT * FROM generation.inputs", &[])
        .is_err());
    assert!(restricted.execute("DELETE FROM map.heads", &[]).is_err());
    http_facade(&url, &reader_url)?;
    Ok(())
}
fn http_facade(writer: &str, reader: &str) -> Result<(), Box<dyn std::error::Error>> {
    use atlas_gis::map_files::MapFiles;
    use atlas_host::map_http::{self, Services};
    use std::sync::{Arc, Mutex};
    let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").map_err(io::Error::other)?);
    let address = server.server_addr().to_ip().unwrap();
    let services = Arc::new(Services {
        reader: Mutex::new(PostgresMaps::connect(reader)?),
        writer: Mutex::new(PostgresMaps::connect(writer)?),
        files: MapFiles::new(std::env::temp_dir()),
        jobs: None,
        frontend: None,
    });
    let running = server.clone();
    let thread = std::thread::spawn(move || map_http::serve(running, services));
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let map = request(
            address,
            "/api/maps/read",
            json!({"method":"open","args":[{"mapId":"island","revision":"spatial"}]}),
        )?;
        assert_eq!(map["state"], "complete");
        let selected = request(
            address,
            "/api/maps/read",
            json!({"method":"features","args":[map["reference"],{"spaceId":"surface","geometry":{"type":"Point","coordinates":[5,5]}}]}),
        )?;
        assert_eq!(selected["items"].as_array().unwrap().len(), 1);
        let saved = request(
            address,
            "/api/maps/library",
            json!({"method":"open","args":["island"]}),
        )?;
        assert_eq!(saved["reference"]["revision"], "spatial");
        let state = json!({"version":0,"regions":[],"views":[]});
        let view = request(
            address,
            "/api/maps/navigation",
            json!({"method":"commit","args":[map["reference"],state,{"kind":"putView","data":{"id":"view","name":"Home","regionId":null,"settings":{}}}]}),
        )?;
        assert_eq!(view["views"][0]["name"], "Home");
        let saved = request(
            address,
            "/api/maps/library",
            json!({"method":"open","args":["island"]}),
        )?;
        assert_eq!(saved["navigation"]["views"], json!([]));
        Ok(())
    })();
    server.unblock();
    thread.join().unwrap()?;
    result
}
fn request(
    address: std::net::SocketAddr,
    path: &str,
    call: Value,
) -> Result<Value, Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    let mut body = Vec::new();
    ciborium::into_writer(&call, &mut body)?;
    let mut socket = std::net::TcpStream::connect(address)?;
    write!(socket, "POST {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/cbor\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())?;
    socket.write_all(&body)?;
    let mut response = Vec::new();
    socket.read_to_end(&mut response)?;
    assert!(
        response.starts_with(b"HTTP/1.1 200"),
        "{}",
        String::from_utf8_lossy(&response)
    );
    let offset = response.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
    Ok(ciborium::from_reader(&response[offset..])?)
}
fn replacement(store: &mut PostgresMaps, original: &MapRef) -> io::Result<()> {
    let left = map("left");
    let right = map("right");
    store.begin(&left, Some(original), false)?;
    store.begin(&right, Some(original), false)?;
    store.append(&left.reference, assets())?;
    store.append(&right.reference, assets())?;
    assert_eq!(store.find_head("island")?.as_ref(), Some(original));
    store.finish(&left.reference)?;
    assert!(store.finish(&right.reference).is_err());
    store.discard(&right.reference)?;
    assert!(store.open(original)?.require_complete().is_ok());
    assert!(store.append(original, assets()).is_err());
    Ok(())
}
fn scoped_queries(store: &mut PostgresMaps) -> io::Result<()> {
    let map = map("spatial");
    let previous = store.find_head("island")?.unwrap();
    store.begin(&map, Some(&previous), false)?;
    let mut hollow = shape();
    hollow["coordinates"].as_array_mut().unwrap().push(json!([
        [4, 4],
        [4, 6],
        [6, 6],
        [6, 4],
        [4, 4]
    ]));
    let mut features: Vec<_> = (0..257)
        .map(|i| feature(&format!("{i:03}"), hollow.clone()))
        .collect();
    let mut elevated = shape();
    for point in elevated["coordinates"][0].as_array_mut().unwrap() {
        point.as_array_mut().unwrap().push(json!(12));
    }
    features.push(feature("last", elevated));
    store.append(&map.reference, serde_json::from_value(json!({"features":features,
        "entities":[{"id":"realm","name":"Coastal union","kind":"polity","people":1200,"places":3}],
        "history":[{"id":"uplift","title":"Uplift","description":"Raised ground","epoch":2,"featureIds":["last"],"attributes":{}}]
    }))?)?;
    let query = FeatureQuery {
        space_id: "surface".into(),
        geometry: Some(serde_json::from_value(
            json!({"type":"Point","coordinates":[5,5]}),
        )?),
        ..Default::default()
    };
    let result = store.features(&map.reference, &query)?;
    assert_eq!(result.items.len(), 1);
    assert_eq!(result.items[0].id, "last");
    let mut query = FeatureQuery {
        space_id: "surface".into(),
        ..Default::default()
    };
    let page = store.features(&map.reference, &query)?;
    assert_eq!(page.items.len(), 256);
    query.cursor = page.next;
    assert_eq!(store.features(&map.reference, &query)?.items.len(), 2);
    assert_eq!(
        store
            .history(&map.reference, "", Some(&["last".into()]))?
            .items
            .len(),
        1
    );
    assert!(store
        .history(&map.reference, "", Some(&["absent".into()]))?
        .items
        .is_empty());
    assert_eq!(
        store.entities(&map.reference, &["realm".into()])?[0].name,
        "Coastal union"
    );
    let bowtie = json!({"type":"Polygon","coordinates":[[[0,0],[10,10],[10,0],[0,10],[0,0]]]});
    assert!(store
        .append(
            &map.reference,
            serde_json::from_value(
                json!({"features":[feature("valid",shape()),feature("invalid",bowtie)]})
            )?
        )
        .is_err());
    query.cursor = None;
    query.feature_ids = Some(vec!["valid".into()]);
    assert!(store.features(&map.reference, &query)?.items.is_empty());
    store.append(&map.reference, assets())?;
    store.finish(&map.reference)
}
fn saves(store: &PostgresMaps) -> io::Result<()> {
    let reference = store.find_head("island")?.unwrap();
    let request = || SaveRequest {
        reference: reference.clone(),
        expected_version: None,
        navigation: Default::default(),
        settings: Default::default(),
    };
    let saved = store.save(request(), "today".into())?;
    assert_eq!(
        store.find_saved("island")?.unwrap().summary.version,
        saved.summary.version
    );
    assert_eq!(store.list_saved("")?.items.len(), 1);
    assert!(store.save(request(), "tomorrow".into()).is_err());
    Ok(())
}
fn interrupted(store: &mut PostgresMaps) -> io::Result<()> {
    let mut initial = map("interrupted");
    initial.reference.map_id = "new-island".into();
    store.begin(&initial, None, true)?;
    assert!(store.finish(&initial.reference).is_err());
    store.discard(&initial.reference)?;
    assert_eq!(store.find_head("new-island")?, Some(initial.reference));
    Ok(())
}
