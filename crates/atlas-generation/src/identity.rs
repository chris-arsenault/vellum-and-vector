use std::io;

pub fn semantic_id(world: &str, kind: &str, key: &str) -> io::Result<String> {
    let namespace = uuid::Uuid::parse_str(world).map_err(io::Error::other)?;
    let key = serde_json::to_string(&[kind, key]).map_err(io::Error::other)?;
    Ok(uuid::Uuid::new_v5(&namespace, key.as_bytes()).to_string())
}
