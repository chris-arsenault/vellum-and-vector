pub mod assets;
mod static_files;
use atlas_gis::map_protocol::{LibraryCall, NavigationCall, ReadCall};
use atlas_gis::{map_files::MapFiles, postgres_maps::PostgresMaps};
use atlas_map::MapRef;
use std::{
    io,
    sync::{Arc, Mutex, MutexGuard},
    thread,
};
use tiny_http::{Header, Method, Request, Response, ResponseBox, Server};

/// Geographic reads and view calculations use the map reader; explicit saves use the writer.
pub struct Services {
    pub reader: Mutex<PostgresMaps>,
    pub writer: Mutex<PostgresMaps>,
    pub files: MapFiles,
    pub jobs: Option<crate::native_jobs::Jobs>,
    pub frontend: Option<std::path::PathBuf>,
}
pub fn serve(server: Arc<Server>, services: Arc<Services>) -> io::Result<()> {
    for mut request in server.incoming_requests() {
        let services = services.clone();
        thread::Builder::new()
            .name("atlas-map-http".into())
            .spawn(move || {
                let response = handle(&mut request, &services).unwrap_or_else(|error| {
                    Response::from_string(
                        serde_json::json!({"message":error.to_string()}).to_string(),
                    )
                    .with_status_code(400)
                    .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
                    .boxed()
                });
                if let Err(error) = request.respond(response) {
                    eprintln!("Map response: {error}");
                }
            })?;
    }
    Ok(())
}
// Arconis: docs/architecture/subsystems.arconis#item=j_be_http — routes HTTP requests, including POST api/generation in CBOR.
fn handle(request: &mut Request, services: &Services) -> io::Result<ResponseBox> {
    let path = request
        .url()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_owned();
    if request.method() == &Method::Post
        && matches!(
            path.as_str(),
            "/api/maps/read" | "/api/maps/navigation" | "/api/maps/library" | "/api/generation"
        )
    {
        if !request
            .headers()
            .iter()
            .any(|h| h.field.equiv("Content-Type") && h.value.as_str() == "application/cbor")
        {
            return Ok(Response::empty(415).boxed());
        }
        let body = match path.as_str() {
            "/api/generation" => {
                let call: crate::native_jobs::Call = decode_request(request)?;
                let result = services
                    .jobs
                    .as_ref()
                    .ok_or_else(|| io::Error::other("Generation is not configured on this server"))?
                    .call(call)?;
                let mut bytes = Vec::new();
                ciborium::into_writer(&result, &mut bytes).map_err(io::Error::other)?;
                bytes
            }
            "/api/maps/read" => {
                let call: ReadCall = decode_request(request)?;
                call.execute(lock(&services.reader)?.access(), &services.files)?
            }
            "/api/maps/navigation" => {
                let call: NavigationCall = decode_request(request)?;
                futures::executor::block_on(
                    call.execute(lock(&services.reader)?.access(), &services.files),
                )?
            }
            _ => {
                let call: LibraryCall = decode_request(request)?;
                call.execute(
                    lock(&services.writer)?.access(),
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                )?
            }
        };
        return Ok(Response::from_data(body)
            .with_header(header("Content-Type", "application/cbor")?)
            .with_header(header("Cache-Control", "no-store")?)
            .boxed());
    }
    if matches!(request.method(), Method::Get | Method::Head) {
        if path == "/health" {
            return Ok(Response::from_string("ok").boxed());
        }
        let segments = path.trim_start_matches('/').split('/').collect::<Vec<_>>();
        if let ["api", "maps", map, revision, "assets", asset] = segments.as_slice() {
            let decode = |v: &str| {
                percent_encoding::percent_decode_str(v)
                    .decode_utf8()
                    .map(|v| v.into_owned())
                    .map_err(io::Error::other)
            };
            let reference = MapRef {
                map_id: decode(map)?,
                revision: decode(revision)?,
            };
            return assets::serve(
                request,
                lock(&services.reader)?.access(),
                &services.files,
                &reference,
                &decode(asset)?,
            );
        }
        if let Some(root) = &services.frontend {
            return static_files::serve(root, &path);
        }
    }
    Ok(
        Response::from_string("{\"message\":\"Map endpoint was not found\"}")
            .with_status_code(404)
            .with_header(header("Content-Type", "application/json")?)
            .boxed(),
    )
}
fn lock(store: &Mutex<PostgresMaps>) -> io::Result<MutexGuard<'_, PostgresMaps>> {
    store
        .lock()
        .map_err(|_| io::Error::other("Map service lock was poisoned"))
}
fn decode_request<T: serde::de::DeserializeOwned>(request: &mut Request) -> io::Result<T> {
    // JavaScript numbers may use either CBOR integer or float encoding. Requests
    // are structured values; deserialize through that model before typed fields.
    let value: serde_json::Value =
        ciborium::from_reader(request.as_reader()).map_err(io::Error::other)?;
    serde_json::from_value(value).map_err(io::Error::other)
}
fn header(name: &str, value: &str) -> io::Result<Header> {
    Header::from_bytes(name, value).map_err(|_| io::Error::other("Invalid HTTP header"))
}
