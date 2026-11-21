//! Backend replies cut down to what an agent needs: small JSON, lists capped with a
//! `truncated` flag.
use serde_json::{json, Value};

pub const LIST_CAP: usize = 200;

fn items<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}
fn layers(descriptor: &Value) -> &[Value] {
    items(descriptor, "layers")
}
fn source_kind(layer: &Value) -> &str {
    layer["source"]["kind"].as_str().unwrap_or("")
}

pub fn saved_maps(page: &Value) -> Value {
    let all = items(page, "items");
    let maps: Vec<Value> = all
        .iter()
        .take(LIST_CAP)
        .map(|m| json!({"name": m["name"], "map": m["reference"], "savedAt": m["savedAt"]}))
        .collect();
    json!({"maps": maps, "next": page["next"], "truncated": all.len() > LIST_CAP})
}

pub fn describe(descriptor: &Value) -> Value {
    let mut terrain = Value::Null;
    let summary: Vec<Value> = layers(descriptor)
        .iter()
        .map(|layer| {
            let types = items(&layer["catalog"], "featureTypes");
            let count: u64 = types.iter().filter_map(|t| t["count"].as_u64()).sum();
            if layer["id"] == "terrain" {
                let raster = &layer["source"]["data"];
                terrain = json!({
                    "width": raster["width"],
                    "height": raster["height"],
                    "cellSpan": raster["cellSpan"],
                    "bands": items(raster, "bands").len(),
                });
            }
            json!({
                "id": layer["id"],
                "name": layer["name"],
                "source": source_kind(layer),
                "geometries": layer["catalog"]["geometries"],
                "kinds": types.len(),
                "featureCount": count,
            })
        })
        .collect();
    json!({
        "map": descriptor["reference"],
        "name": descriptor["name"],
        "profile": descriptor["profile"],
        "boundsMetres": descriptor["bounds"],
        "terrainRaster": terrain,
        "layers": summary,
    })
}

/// Accept `landmasses` or `vector:landmasses` and return the layer's published id.
pub fn layer_id(descriptor: &Value, given: &str) -> Result<String, String> {
    let wanted = [given.to_owned(), format!("vector:{given}")];
    let all = layers(descriptor);
    let found = all
        .iter()
        .filter_map(|l| l["id"].as_str())
        .find(|id| wanted.iter().any(|w| w == id));
    found.map(str::to_owned).ok_or_else(|| {
        let ids: Vec<&str> = all.iter().filter_map(|l| l["id"].as_str()).collect();
        format!(
            "No layer \"{given}\" on this map. Layers: {}",
            ids.join(", ")
        )
    })
}

pub fn kinds(descriptor: &Value, only: Option<&str>) -> Result<Value, String> {
    let filter = only.map(|layer| layer_id(descriptor, layer)).transpose()?;
    let mut rows = Vec::new();
    let mut per_layer = Vec::new();
    for layer in layers(descriptor)
        .iter()
        .filter(|l| source_kind(l) == "vector")
    {
        let id = layer["id"].as_str().unwrap_or_default();
        let types = items(&layer["catalog"], "featureTypes");
        per_layer.push(json!({"layer": id, "kinds": types.len()}));
        if filter.as_deref().is_some_and(|wanted| wanted != id) {
            continue;
        }
        rows.extend(types.iter().map(|t| kind_row(id, t)));
    }
    let truncated = rows.len() > LIST_CAP;
    rows.truncate(LIST_CAP);
    Ok(json!({"layers": per_layer, "kinds": rows, "truncated": truncated}))
}
fn kind_row(layer: &str, kind: &Value) -> Value {
    let path: Vec<&str> = items(kind, "path")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    json!({
        "layer": layer,
        "id": kind["id"],
        "kind": kind["kind"],
        "label": kind["label"],
        "path": path.join(" / "),
        "geometry": kind["geometries"],
    })
}

pub fn features(page: &Value, limit: usize) -> Value {
    let all = items(page, "items");
    let truncated = all.len() > limit;
    let shown = &all[..all.len().min(limit)];
    let next = if truncated {
        shown.last().map_or(Value::Null, |f| f["id"].clone())
    } else {
        page["next"].clone()
    };
    let rows: Vec<Value> = shown
        .iter()
        .map(|f| {
            json!({
                "id": f["id"], "layer": f["layerId"], "kind": f["kind"], "name": f["name"],
                "geometry": f["geometry"], "attributes": f["attributes"],
            })
        })
        .collect();
    json!({"features": rows, "next": next, "truncated": truncated})
}

pub fn edit_outcome(outcome: &Value) -> Value {
    json!({
        "map": outcome["map"]["reference"],
        "changed": outcome["changed"],
        "created": outcome["created"],
        "history": history(&outcome["history"]),
    })
}
/// The most recent steps, capped at 200.
pub fn history(history: &Value) -> Value {
    let steps = items(history, "steps");
    let from = steps.len().saturating_sub(LIST_CAP);
    json!({"steps": &steps[from..], "truncated": from > 0})
}
