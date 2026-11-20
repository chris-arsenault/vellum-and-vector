use atlas_host::{context_files::Retention, context_inventory::InputEntry};
use atlas_map::Id;
use serde_json::json;
use std::fs;

#[test]
fn surviving_child_retains_alias_bytes_and_unknown_inputs_block_cleanup() {
    let root = std::env::temp_dir().join(format!("atlas-retention-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("jobs")).unwrap();
    let world = Id::from_name("world");
    let space = Id::from_name("surface");
    let child = Id::from_name("child");
    let crs = Id::from_name("planar-metres");
    let scope = json!({"worldId":world,"spaceId":space,"areaId":child});
    for (id, source) in [("child", Some("parent")), ("parent", None)] {
        let mut descriptor = json!({"schemaVersion":1,"id":id,"revision":1,"scope":scope,"crsId":crs,"bounds":[0,0,10,10],"precision":0.01,"layout":"regular","sampling":{"width":2,"height":2},"state":"ready","arrays":[]});
        if let Some(source) = source {
            descriptor["arrays"] = json!([{"name":"height","dtype":"float64","shape":[4],"chunkShape":[4],"unit":"metre","quantity":"intensive","source":{"resourceId":source,"array":"height"}}]);
        }
        fs::create_dir(root.join(id)).unwrap();
        fs::write(
            root.join(id).join("resource.json"),
            serde_json::to_vec(&descriptor).unwrap(),
        )
        .unwrap();
    }
    let mut input = InputEntry {
        reference: None,
        catalog: "child".into(),
        document: json!({"world":{"fields":[{"resourceId":"child"}]},"scope":{"worldId":world,"spaceId":space,"areaId":child,"footprint":{"type":"Polygon","coordinates":[[[0,0],[10,0],[10,10],[0,10],[0,0]]]},"crsId":crs,"resolution":1,"revision":1,"time":"present"},"coverage":[],"fieldPatches":[]}),
    };
    input.document["coverage"] = json!([{"resourceId":"logical-surface"}]);
    let retained = Retention::collect(&[input], &[], &root.join("jobs"), &root);
    assert!(retained.problems.is_empty(), "{:?}", retained.problems);
    assert!(retained.resources.contains("parent"));
    assert!(retained.resources.contains("child"));
    assert!(!retained.resources.contains("logical-surface"));
    let bad = InputEntry {
        reference: None,
        catalog: "unreadable".into(),
        document: json!({"unknown":true}),
    };
    assert!(Retention::collect(&[bad], &[], &root.join("jobs"), &root)
        .require_known()
        .is_err());
    fs::remove_dir_all(root).unwrap();
}
