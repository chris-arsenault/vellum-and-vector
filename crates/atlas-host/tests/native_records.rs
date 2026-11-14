#![cfg(not(target_arch = "wasm32"))]
use atlas_generation::features::{
    network::{NetworkReader, NetworkWorkspace, Reach, Selection},
    Feature, FeatureReader, FeatureSelection, FeatureWorkspace,
};
use atlas_host::record_store::Workspace;
use serde_json::json;
use std::{
    io,
    time::{SystemTime, UNIX_EPOCH},
};

fn workspace() -> io::Result<Workspace> {
    Workspace::create(std::env::temp_dir().join(format!(
            "atlas-records-{}-{}.sqlite",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )))
}
fn feature(id: usize) -> Feature {
    serde_json::from_value(json!({
        "id":id.to_string(),"name":"Forest","kind":"forest","layerId":"ecology",
        "areaId":if id.is_multiple_of(2) {"map"}else{"child"},
        "geometry":{"type":"Point","coordinates":[10.0000001,20]},"detail":{},"attributes":{},
        "relations":[],"state":"generated","protected":false,"actor":"generator",
        "generationId":null,"causes":[]
    }))
    .unwrap()
}
#[test]
fn completed_input_copy_keeps_its_field_geography_and_records_private() -> io::Result<()> {
    use atlas_gis::sql::Database;
    use atlas_host::{generation_world::CreateWorld, local_inputs::LocalInputs};
    use atlas_map::MapRef;
    use std::rc::Rc;
    let path = std::env::temp_dir().join(format!("atlas-inputs-{}.sqlite", uuid::Uuid::new_v4()));
    let source_db = Rc::new(Database::open(&path)?);
    let source = LocalInputs::open(source_db.clone())?;
    let destination = LocalInputs::open(Rc::new(Database::open(":memory:")?))?;
    let mut document = CreateWorld {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Input source".into(),
        seed: 1,
        width: 100.0,
        height: 100.0,
        settings: None,
        boundary_mode: None,
    }
    .create()?;
    let reference = MapRef {
        map_id: document.scope.located.area_id.clone(),
        revision: "one".into(),
    };
    document.world["fields"] = json!([{"id":"height","areaId":reference.map_id}]);
    let records = workspace()?;
    records.features().put(feature(0))?;
    let geography = json!({"id":"layout","scope":document.scope.located,"lakes":[],"ocean":null});
    source.store(
        &reference,
        &document,
        &records.features(),
        &records.networks(),
        std::slice::from_ref(&geography),
    )?;
    destination.copy_from(path.to_str().unwrap(), std::slice::from_ref(&reference))?;
    assert_eq!(
        destination.document(&reference)?.world["fields"],
        document.world["fields"]
    );
    assert_eq!(
        destination.geography(&document.scope.located, "layout")?,
        geography
    );
    let copied = workspace()?;
    destination.load_records(&reference, &mut copied.features(), &mut copied.networks())?;
    assert!(copied.features().get("0")?.is_some());
    assert!(source_db
        .query(
            "SELECT name FROM sqlite_schema WHERE name LIKE 'map_%'",
            &[]
        )?
        .is_empty());
    drop(source);
    drop(source_db);
    std::fs::remove_file(path)?;
    Ok(())
}
#[test]
fn procedural_records_use_captured_sources_without_overwriting_drawings() -> io::Result<()> {
    use atlas_generation::{atlas::world::Sources, features::procedural};
    use std::{collections::BTreeSet, rc::Rc};
    let workspace = workspace()?;
    let mut drawn = feature(0);
    drawn.map_only = Some(true);
    workspace.source_features().put(drawn.clone())?;
    workspace.source_features().put(feature(1))?;
    let source = Sources {
        features: Rc::new(workspace.source_features()),
        networks: Rc::new(workspace.source_networks()),
        contracted: BTreeSet::new(),
    };
    let original =
        procedural::initialize(source, &mut workspace.features(), &mut workspace.networks())?;
    assert!(original.features.get("0")?.is_none());
    assert!(workspace.features().get("0")?.is_none());
    assert_eq!(workspace.source_features().get("0")?, Some(drawn));
    let mut working = workspace.features().get("1")?.unwrap();
    working.name = "New geography".into();
    workspace.features().put(working)?;
    assert_eq!(original.features.get("1")?.unwrap().name, "Forest");
    Ok(())
}
// Existing TypeScript workspace cases: detached reads, live paging, source isolation and revisions.
#[test]
fn records_remain_detached_and_iteration_reads_current_values() -> io::Result<()> {
    let workspace = workspace()?;
    let reader = workspace.features();
    let mut writer = workspace.features();
    for id in 0..150 {
        writer.put(feature(id))?;
    }
    let mut rows = reader.values(FeatureSelection {
        area_id: Some("map"),
        ..Default::default()
    })?;
    assert_eq!(rows.next().unwrap()?.id, "0");
    let mut changed = writer.get("2")?.unwrap();
    changed.name = "Changed after page selection".into();
    assert_eq!(writer.get("2")?.unwrap().name, "Forest");
    writer.put(changed)?;
    writer.remove("4")?;
    let remaining = rows.collect::<io::Result<Vec<_>>>()?;
    assert_eq!(remaining[0].name, "Changed after page selection");
    assert_eq!(remaining.len(), 73);
    assert_eq!(remaining.last().unwrap().id, "148");
    let before = writer
        .revisions()?
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .find(|(id, _)| id == "2")
        .unwrap()
        .1;
    writer.remove("2")?;
    writer.put(feature(2))?;
    let after = writer
        .revisions()?
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .find(|(id, _)| id == "2")
        .unwrap()
        .1;
    assert!(after > before);
    assert!(workspace.source_features().get("2")?.is_none());
    Ok(())
}
#[test]
fn network_endpoint_indexes_follow_explicit_writes() -> io::Result<()> {
    let workspace = workspace()?;
    let mut networks = workspace.networks();
    for id in 0..140 {
        networks.put_reach(Reach {
            id: format!("reach-{id}"),
            feature_id: format!("feature-{}", id % 2),
            start: format!("node-{id}"),
            end: format!("node-{}", id + 1),
            geometry: serde_json::from_value(
                json!({"type":"LineString","coordinates":[[id,0],[id+1,0]]}),
            )?,
            flow: f64::from(id),
            end_flow: Some(f64::from(id + 1)),
        })?;
    }
    let selection = Selection {
        node_id: Some("node-70"),
        ..Default::default()
    };
    let connected = networks
        .reaches(selection)?
        .collect::<io::Result<Vec<_>>>()?;
    assert_eq!(
        connected.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        ["reach-69", "reach-70"]
    );
    let mut reach = connected[0].clone();
    reach.end = "moved-junction".into();
    assert_eq!(networks.reach(&reach.id)?.unwrap().end, "node-70");
    networks.put_reach(reach)?;
    assert_eq!(
        networks
            .reaches(selection)?
            .collect::<io::Result<Vec<_>>>()?
            .len(),
        1
    );
    assert!(workspace.source_networks().reach("reach-69")?.is_none());
    Ok(())
}
