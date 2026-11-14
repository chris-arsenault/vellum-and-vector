//! Serve the selected backend frontend from the same LAN origin as its facade.
use super::header;
use std::{
    fs::File,
    io::{self, Read},
    path::{Component, Path},
};
use tiny_http::{Response, ResponseBox};
pub(super) fn serve(root: &Path, url: &str) -> io::Result<ResponseBox> {
    let decoded = percent_encoding::percent_decode_str(url)
        .decode_utf8()
        .map_err(io::Error::other)?;
    let relative = if decoded == "/" {
        Path::new("index.html")
    } else {
        Path::new(decoded.trim_start_matches('/'))
    };
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Ok(Response::empty(404).boxed());
    }
    let path = root.join(relative);
    let mut file = match File::open(path) {
        Ok(file) if file.metadata()?.is_file() => file,
        Ok(_) => return Ok(Response::empty(404).boxed()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Response::empty(404).boxed())
        }
        Err(error) => return Err(error),
    };
    let extension = relative
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    let media = match extension {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "wasm" => "application/wasm",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    };
    let response = if relative == Path::new("index.html") {
        let mut html = String::new();
        file.read_to_string(&mut html)?;
        let marker = "data-atlas-host=\"browser\"";
        if !html.contains(marker) {
            return Err(io::Error::other(
                "Frontend document has no execution host declaration",
            ));
        }
        Response::from_string(html.replace(marker, "data-atlas-host=\"backend\"")).boxed()
    } else {
        Response::from_file(file).boxed()
    };
    Ok(response
        .with_header(header("Content-Type", media)?)
        .with_header(header("Cross-Origin-Opener-Policy", "same-origin")?)
        .with_header(header("Cross-Origin-Embedder-Policy", "require-corp")?)
        .with_header(header(
            "Cache-Control",
            if relative.starts_with("assets") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            },
        )?)
        .boxed())
}
