#![cfg(not(target_arch = "wasm32"))]
//! MCP server over stdio for authoring maps through a running atlas backend.
//! Usage: `atlas_mcp [backend-url]`; the URL falls back to `ATLAS_URL`, then the local default.
use atlas_host::mcp::{HttpBackend, Server};
use std::{env, io};

const DEFAULT_URL: &str = "http://127.0.0.1:4123";

fn main() -> io::Result<()> {
    let url = env::args()
        .nth(1)
        .or_else(|| env::var("ATLAS_URL").ok())
        .unwrap_or_else(|| DEFAULT_URL.into());
    let server = Server::new(HttpBackend::new(&url));
    server.serve(io::stdin().lock(), io::stdout().lock())
}
