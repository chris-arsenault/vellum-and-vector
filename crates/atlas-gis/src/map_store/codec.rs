use serde::{de::DeserializeOwned, Serialize};
use std::io;

pub fn encode(value: &impl Serialize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    ciborium::into_writer(value, &mut bytes).map_err(io::Error::other)?;
    Ok(bytes)
}
pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> io::Result<T> {
    ciborium::from_reader(bytes).map_err(io::Error::other)
}
