//! The transport behind the MCP tools: one JSON call to a LAN backend endpoint. The backend
//! speaks CBOR; this converts at the boundary so the rest of the adapter handles JSON values.
use serde_json::Value;
use std::time::Duration;

/// The map service endpoints the adapter uses, each served at `/api/maps/<name>`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Endpoint {
    Read,
    Editing,
    Library,
}
impl Endpoint {
    pub fn path(self) -> &'static str {
        match self {
            Self::Read => "/api/maps/read",
            Self::Editing => "/api/maps/editing",
            Self::Library => "/api/maps/library",
        }
    }
}

/// Sends one `{"method":..,"args":[..]}` call and returns the decoded JSON result. Errors
/// carry a message an agent can read.
pub trait Backend {
    fn call(&self, endpoint: Endpoint, request: &Value) -> Result<Value, String>;
}

/// The LAN backend over HTTP with CBOR bodies.
pub struct HttpBackend {
    base: String,
    agent: ureq::Agent,
}
impl HttpBackend {
    pub fn new(base: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(120)))
            .build()
            .into();
        Self {
            base: base.trim_end_matches('/').to_owned(),
            agent,
        }
    }
}
impl Backend for HttpBackend {
    fn call(&self, endpoint: Endpoint, request: &Value) -> Result<Value, String> {
        let mut body = Vec::new();
        ciborium::into_writer(request, &mut body).map_err(|e| e.to_string())?;
        let url = format!("{}{}", self.base, endpoint.path());
        let mut response = self
            .agent
            .post(&url)
            .header("Content-Type", "application/cbor")
            .send(&body[..])
            .map_err(|e| format!("The atlas backend at {} is unreachable: {e}", self.base))?;
        let status = response.status().as_u16();
        let bytes = response
            .body_mut()
            .read_to_vec()
            .map_err(|e| format!("The atlas backend response could not be read: {e}"))?;
        if status >= 400 {
            return Err(failure(status, &bytes));
        }
        ciborium::from_reader(&bytes[..]).map_err(|e| format!("Unreadable backend reply: {e}"))
    }
}
fn failure(status: u16, bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.get("message").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_else(|| text.trim().to_owned());
    if message.is_empty() {
        format!("The atlas backend refused the call (HTTP {status})")
    } else {
        format!("The atlas backend refused the call (HTTP {status}): {message}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failures_prefer_the_backends_message() {
        let text = failure(500, br#"{"message":"No such map"}"#);
        assert!(text.contains("No such map") && text.contains("500"));
        assert!(failure(404, b"").contains("404"));
    }
}
