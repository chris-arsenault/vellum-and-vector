//! A Model Context Protocol server over stdio that lets an agent author maps with the same
//! calls the editor sends to the LAN backend (ADR 0019). It is an adapter: tools translate to
//! backend calls and results back to small JSON text; no map logic lives here.
mod client;
mod definitions;
mod results;
mod tools;

pub use client::{Backend, Endpoint, HttpBackend};
pub use definitions::tool_definitions;

use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

pub const PROTOCOL_VERSION: &str = "2024-11-05";
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;

pub struct Server<B: Backend> {
    backend: B,
}
impl<B: Backend> Server<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }
    /// Read newline-delimited JSON-RPC messages until the input closes.
    pub fn serve(&self, input: impl BufRead, mut output: impl Write) -> io::Result<()> {
        for line in input.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let reply = match serde_json::from_str::<Value>(&line) {
                Ok(message) => self.handle(&message),
                Err(e) => Some(error(
                    Value::Null,
                    PARSE_ERROR,
                    &format!("Parse error: {e}"),
                )),
            };
            if let Some(reply) = reply {
                writeln!(output, "{reply}")?;
                output.flush()?;
            }
        }
        Ok(())
    }
    /// One message in, the reply out; notifications (no `id`) have none.
    pub fn handle(&self, message: &Value) -> Option<Value> {
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            return message
                .get("id")
                .map(|id| error(id.clone(), INVALID_REQUEST, "A request needs a method"));
        };
        let id = message.get("id")?.clone();
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        Some(match self.dispatch(method, &params) {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err((code, text)) => error(id, code, &text),
        })
    }
    fn dispatch(&self, method: &str, params: &Value) -> Result<Value, (i64, String)> {
        match method {
            "initialize" => Ok(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "atlas-mcp", "version": env!("CARGO_PKG_VERSION")},
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": tool_definitions()})),
            "tools/call" => self.call_tool(params),
            other => Err((METHOD_NOT_FOUND, format!("Method not found: {other}"))),
        }
    }
    fn call_tool(&self, params: &Value) -> Result<Value, (i64, String)> {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .ok_or((INVALID_PARAMS, "tools/call needs a tool name".to_owned()))?;
        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));
        Ok(match tools::call(&self.backend, name, &arguments) {
            Ok(value) => text_result(&value, false),
            Err(message) => text_result(&Value::String(message), true),
        })
    }
}
fn text_result(value: &Value, is_error: bool) -> Value {
    let text = match value {
        Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    };
    let mut result = json!({"content":[{"type":"text","text":text}]});
    if is_error {
        result["isError"] = Value::Bool(true);
    }
    result
}
fn error(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}
