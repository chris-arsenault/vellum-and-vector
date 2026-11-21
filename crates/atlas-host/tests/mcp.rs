#![cfg(not(target_arch = "wasm32"))]
//! The MCP adapter driven through in-memory stdio with a fake backend: no network.
use atlas_host::mcp::{Backend, Endpoint, Server};
use serde_json::{json, Value};
use std::{cell::RefCell, io::Cursor};

struct Fake {
    calls: RefCell<Vec<(Endpoint, Value)>>,
    reply: Result<Value, String>,
}
impl Backend for &Fake {
    fn call(&self, endpoint: Endpoint, request: &Value) -> Result<Value, String> {
        self.calls.borrow_mut().push((endpoint, request.clone()));
        self.reply.clone()
    }
}
fn fake(reply: Result<Value, String>) -> Fake {
    Fake {
        calls: RefCell::default(),
        reply,
    }
}
fn run(backend: &Fake, messages: &[Value]) -> Vec<Value> {
    let input: String = messages.iter().map(|m| format!("{m}\n")).collect();
    let mut output = Vec::new();
    Server::new(backend)
        .serve(Cursor::new(input), &mut output)
        .unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}
fn call_tool(name: &str, arguments: Value) -> Value {
    json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":name,"arguments":arguments}})
}

#[test]
fn the_handshake_answers_initialize_and_stays_silent_on_notifications() {
    let backend = fake(Ok(Value::Null));
    let replies = run(
        &backend,
        &[
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            json!({"jsonrpc":"2.0","id":2,"method":"ping"}),
        ],
    );
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[0]["result"]["protocolVersion"], "2024-11-05");
    assert!(replies[0]["result"]["capabilities"]["tools"].is_object());
    assert!(replies[0]["result"]["serverInfo"]["name"].is_string());
    assert_eq!(replies[1]["id"], 2);
}

#[test]
fn tools_list_offers_the_nine_tools_with_object_schemas() {
    let backend = fake(Ok(Value::Null));
    let replies = run(
        &backend,
        &[json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})],
    );
    let tools = replies[0]["result"]["tools"].as_array().unwrap();
    let mut names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "apply_edit",
            "create_map",
            "describe_map",
            "edit_history",
            "edit_terrain",
            "list_kinds",
            "list_maps",
            "query_features",
            "redo",
            "undo"
        ]
    );
    for tool in tools {
        assert_eq!(tool["inputSchema"]["type"], "object", "{tool}");
        assert!(!tool["description"].as_str().unwrap().is_empty());
    }
}

#[test]
fn create_map_forwards_the_exact_new_map_call() {
    let reference = json!({"mapId":"a","revision":"b"});
    let backend = fake(Ok(reference.clone()));
    let replies = run(
        &backend,
        &[call_tool(
            "create_map",
            json!({"name":"Isles","profile":"region","width":1000.0}),
        )],
    );
    let calls = backend.calls.borrow();
    assert_eq!(calls[0].0, Endpoint::Editing);
    assert_eq!(
        calls[0].1,
        json!({"method":"newMap","args":[{"name":"Isles","profile":"region","width":1000.0}]})
    );
    let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(text).unwrap()["map"],
        reference
    );
    assert!(replies[0]["result"].get("isError").is_none());
}

#[test]
fn undo_routes_features_and_terrain_to_their_own_calls() {
    let backend = fake(Ok(json!({"canUndo":true})));
    let map = json!({"mapId":"a","revision":"b"});
    run(
        &backend,
        &[
            call_tool("undo", json!({"map":map,"target":"terrain"})),
            call_tool("redo", json!({"map":map,"target":"features"})),
        ],
    );
    let calls = backend.calls.borrow();
    assert_eq!(calls[0].1["method"], "undoTerrain");
    assert_eq!(calls[1].1["method"], "redo");
}

#[test]
fn query_features_asks_for_the_primary_space_and_normalises_layer_ids() {
    let backend = fake(Ok(json!({
        "primarySpaceId":"s1",
        "layers":[{"id":"vector:landmasses","source":{"kind":"vector"}}],
        "items":[], "next": null,
    })));
    run(
        &backend,
        &[call_tool(
            "query_features",
            json!({"map":{"mapId":"a","revision":"b"},"layer":"landmasses"}),
        )],
    );
    let calls = backend.calls.borrow();
    assert_eq!(calls[1].1["method"], "features");
    assert_eq!(calls[1].1["args"][1]["spaceId"], "s1");
    assert_eq!(
        calls[1].1["args"][1]["layerIds"],
        json!(["vector:landmasses"])
    );
}

#[test]
fn a_failing_backend_is_a_tool_error_not_a_protocol_error() {
    let backend = fake(Err("The atlas backend is unreachable".into()));
    let replies = run(&backend, &[call_tool("list_maps", json!({}))]);
    assert!(replies[0].get("error").is_none());
    assert_eq!(replies[0]["result"]["isError"], true);
    assert!(replies[0]["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("unreachable"));
}

#[test]
fn bad_arguments_are_tool_errors_and_unknown_methods_are_protocol_errors() {
    let backend = fake(Ok(Value::Null));
    let replies = run(
        &backend,
        &[
            call_tool(
                "apply_edit",
                json!({"command":{"command":"delete","ids":[]}}),
            ),
            json!({"jsonrpc":"2.0","id":3,"method":"resources/list"}),
        ],
    );
    assert_eq!(replies[0]["result"]["isError"], true);
    assert_eq!(replies[1]["error"]["code"], -32601);
    assert!(backend.calls.borrow().is_empty());
}
