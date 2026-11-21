//! Tool calls: each maps its arguments onto the backend calls the editor already sends.
use super::{
    client::{Backend, Endpoint},
    results,
};
use serde_json::{json, Map, Value};

pub fn call(backend: &dyn Backend, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "list_maps" => list_maps(backend, args),
        "create_map" => create_map(backend, args),
        "describe_map" => Ok(results::describe(&open(backend, args)?)),
        "list_kinds" => list_kinds(backend, args),
        "query_features" => query_features(backend, args),
        "apply_edit" => apply_edit(backend, args),
        "edit_terrain" => edit_terrain(backend, args),
        "undo" => step(backend, args, "undo"),
        "redo" => step(backend, args, "redo"),
        "edit_history" => {
            let map = map_ref(args)?;
            let reply = backend.call(Endpoint::Editing, &method("history", vec![map]))?;
            Ok(results::history(&reply))
        }
        other => Err(format!("Unknown tool: {other}")),
    }
}

fn method(name: &str, args: Vec<Value>) -> Value {
    json!({"method": name, "args": args})
}
fn field<'a>(args: &'a Value, key: &str) -> Option<&'a Value> {
    args.get(key).filter(|v| !v.is_null())
}
fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    field(args, key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("`{key}` is required and must be a string"))
}
/// The `map` argument, which must be the `{mapId, revision}` object the tools return.
fn map_ref(args: &Value) -> Result<Value, String> {
    let map = field(args, "map").ok_or("`map` is required: pass the map reference object")?;
    let valid = ["mapId", "revision"]
        .iter()
        .all(|k| map.get(k).is_some_and(Value::is_string));
    if !valid {
        return Err("`map` must be an object {\"mapId\":..., \"revision\":...}".into());
    }
    Ok(json!({"mapId": map["mapId"], "revision": map["revision"]}))
}
fn open(backend: &dyn Backend, args: &Value) -> Result<Value, String> {
    let map = map_ref(args)?;
    backend.call(Endpoint::Read, &method("open", vec![map]))
}

fn list_maps(backend: &dyn Backend, args: &Value) -> Result<Value, String> {
    let cursor = field(args, "cursor").cloned().unwrap_or(Value::Null);
    let reply = backend.call(Endpoint::Library, &method("list", vec![cursor]))?;
    Ok(results::saved_maps(&reply))
}
fn create_map(backend: &dyn Backend, args: &Value) -> Result<Value, String> {
    let mut request = Map::new();
    request.insert("name".into(), text(args, "name")?.into());
    request.insert("profile".into(), text(args, "profile")?.into());
    for key in ["width", "height"] {
        if let Some(value) = field(args, key) {
            request.insert(key.into(), value.clone());
        }
    }
    let reply = backend.call(
        Endpoint::Editing,
        &method("newMap", vec![Value::Object(request)]),
    )?;
    Ok(json!({"map": reply}))
}
fn list_kinds(backend: &dyn Backend, args: &Value) -> Result<Value, String> {
    let descriptor = open(backend, args)?;
    results::kinds(&descriptor, field(args, "layer").and_then(Value::as_str))
}
fn query_features(backend: &dyn Backend, args: &Value) -> Result<Value, String> {
    let descriptor = open(backend, args)?;
    let mut query = Map::new();
    query.insert("spaceId".into(), descriptor["primarySpaceId"].clone());
    if let Some(layer) = field(args, "layer").and_then(Value::as_str) {
        let id = results::layer_id(&descriptor, layer)?;
        query.insert("layerIds".into(), json!([id]));
    }
    for (from, to) in [("bounds", "bounds"), ("text", "text"), ("cursor", "cursor")] {
        if let Some(value) = field(args, from) {
            query.insert(to.into(), value.clone());
        }
    }
    let limit = field(args, "limit").and_then(Value::as_u64).unwrap_or(50);
    let reply = backend.call(
        Endpoint::Read,
        &method("features", vec![map_ref(args)?, Value::Object(query)]),
    )?;
    Ok(results::features(
        &reply,
        limit.clamp(1, results::LIST_CAP as u64) as usize,
    ))
}
fn apply_edit(backend: &dyn Backend, args: &Value) -> Result<Value, String> {
    let command = field(args, "command").filter(|c| c.is_object());
    let command = command.ok_or("`command` is required and must be an EditCommand object")?;
    let reply = backend.call(
        Endpoint::Editing,
        &method("edit", vec![map_ref(args)?, command.clone()]),
    )?;
    Ok(results::edit_outcome(&reply))
}
fn edit_terrain(backend: &dyn Backend, args: &Value) -> Result<Value, String> {
    let edit = field(args, "edit").filter(|e| e.is_object());
    let edit = edit.ok_or("`edit` is required and must be a TerrainEdit object")?;
    backend.call(
        Endpoint::Editing,
        &method("terrain", vec![map_ref(args)?, edit.clone()]),
    )
}
fn step(backend: &dyn Backend, args: &Value, direction: &str) -> Result<Value, String> {
    let map = map_ref(args)?;
    match text(args, "target")? {
        "features" => {
            let reply = backend.call(Endpoint::Editing, &method(direction, vec![map]))?;
            Ok(results::edit_outcome(&reply))
        }
        "terrain" => {
            let name = format!("{direction}Terrain");
            backend.call(Endpoint::Editing, &method(&name, vec![map]))
        }
        other => Err(format!(
            "`target` must be \"features\" or \"terrain\", not \"{other}\""
        )),
    }
}
