//! Compile the design catalog's selectors without embedding workbook prose in the atlas.
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf};

fn main() {
    let source = "../../docs/design/process-contracts/strategies.dataset.json";
    println!("cargo:rerun-if-changed={source}");
    let dataset: Value = serde_json::from_slice(&fs::read(source).unwrap()).unwrap();
    let mut policies = Vec::new();
    let mut review = Vec::new();
    for record in dataset["items"].as_array().unwrap() {
        let mut scopes = Vec::new();
        for scope in record["Applicability"].as_array().unwrap() {
            let shared = record["Shared contract"].as_object().unwrap();
            let overrides = scope["Map-specific fields"].as_object().unwrap();
            let mut fields = shared.clone();
            fields.extend(overrides.clone());
            let defaults: serde_json::Map<_, _> = shared
                .iter()
                .filter(|(key, _)| overrides.contains_key(*key))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            if !defaults.is_empty() {
                fields.insert("Overridden shared fields".into(), Value::Object(defaults));
            }
            fields.insert("Process ID".into(), record["Process ID"].clone());
            fields.insert("Strategy ID".into(), record["Strategy ID"].clone());
            fields.insert("Strategy kind".into(), record["Strategy kind"].clone());
            fields.insert("Map type".into(), scope["Map type"].clone());
            for key in ["Resolution", "NoOp justification"] {
                if let Some(value) = scope.get(key) {
                    fields.insert(key.into(), value.clone());
                }
            }
            for key in [
                "Clock",
                "Composition order",
                "Contract status",
                "Transferred to",
                "Required bindings",
            ] {
                if let Some(value) = record.get(key) {
                    fields.insert(key.into(), value.clone());
                }
            }
            review.push(fields);
            scopes.push(json!({
                "map": scope["Map type"], "resolution": scope["Resolution"],
                "reason": scope["NoOp justification"]
            }));
        }
        // Proposed strategies remain in the design review until adopted for execution.
        if record["Contract status"] == "Proposed" {
            continue;
        }
        policies.push(json!({
            "process": record["Process ID"], "id": record["Strategy ID"],
            "kind": record["Strategy kind"], "clock": record["Clock"],
            "order": record["Composition order"], "scopes": scopes,
            "required": record.get("Required bindings").cloned().unwrap_or_else(|| json!([]))
        }));
    }
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let catalog = "../../docs/design/process-contracts/district-types.dataset.json";
    println!("cargo:rerun-if-changed={catalog}");
    let districts: Value = serde_json::from_slice(&fs::read(catalog).unwrap()).unwrap();
    let entries: Vec<_> = districts["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(
            |row| json!({"Type ID":row["Type ID"], "Category":row["Category"], "Name":row["Name"]}),
        )
        .collect();
    fs::write(
        out.join("district-types.json"),
        serde_json::to_vec(&entries).unwrap(),
    )
    .unwrap();
    fs::write(
        out.join("process-strategies.json"),
        serde_json::to_vec(&policies).unwrap(),
    )
    .unwrap();
    fs::write(
        out.join("process-applicability.json"),
        serde_json::to_vec_pretty(&json!({"items": review})).unwrap(),
    )
    .unwrap();
}
