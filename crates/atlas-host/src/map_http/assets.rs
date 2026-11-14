use super::header;
use atlas_gis::{map_files::MapFiles, map_store::MapAccess};
use atlas_map::MapRef;
use std::io::{self, Read, Seek, SeekFrom};
use tiny_http::{Request, Response, ResponseBox, StatusCode};
pub(super) fn serve(
    request: &Request,
    maps: &dyn MapAccess,
    files: &MapFiles,
    r: &MapRef,
    id: &str,
) -> io::Result<ResponseBox> {
    let asset = maps.asset(r, id)?;
    let mut file = files.open(&asset.location)?;
    let size = file.metadata()?.len();
    if size != asset.byte_length {
        return Err(io::Error::other(
            "Published map asset length differs from its record",
        ));
    }
    let mut headers = vec![
        header("Content-Type", &asset.media_type)?,
        header("Accept-Ranges", "bytes")?,
        header("Cache-Control", "private, max-age=31536000, immutable")?,
    ];
    let range = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str());
    let range = match byte_range(range, size) {
        Ok(value) => value,
        Err(_) => {
            headers.push(header("Content-Range", &format!("bytes */{size}"))?);
            return Ok(Response::new(StatusCode(416), headers, io::empty(), Some(0), None).boxed());
        }
    };
    let (status, length) = match range {
        Some((start, end)) => {
            file.seek(SeekFrom::Start(start))?;
            headers.push(header(
                "Content-Range",
                &format!("bytes {start}-{end}/{size}"),
            )?);
            (206, end - start + 1)
        }
        None => (200, size),
    };
    // tiny_http suppresses response bodies for HEAD while retaining the declared length.
    Ok(Response::new(
        StatusCode(status),
        headers,
        file.take(length),
        Some(usize::try_from(length).map_err(io::Error::other)?),
        None,
    )
    .boxed())
}
pub fn byte_range(header: Option<&str>, size: u64) -> io::Result<Option<(u64, u64)>> {
    let Some(header) = header else {
        return Ok(None);
    };
    let error = || io::Error::other("Unsatisfiable byte range");
    let (left, right) = header
        .strip_prefix("bytes=")
        .and_then(|v| v.split_once('-'))
        .ok_or_else(error)?;
    if size == 0
        || (left.is_empty() && right.is_empty())
        || !left
            .bytes()
            .chain(right.bytes())
            .all(|c| c.is_ascii_digit())
    {
        return Err(error());
    }
    let start = if left.is_empty() {
        size.saturating_sub(right.parse::<u64>().map_err(|_| error())?)
    } else {
        left.parse().map_err(|_| error())?
    };
    let end = if !left.is_empty() && !right.is_empty() {
        size.saturating_sub(1)
            .min(right.parse::<u64>().map_err(|_| error())?)
    } else {
        size - 1
    };
    if start > end || start >= size || start > 9_007_199_254_740_991 || end > 9_007_199_254_740_991
    {
        return Err(error());
    }
    Ok(Some((start, end)))
}
