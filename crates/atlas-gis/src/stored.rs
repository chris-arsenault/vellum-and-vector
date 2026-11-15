//! Repository format metadata, separate from application releases and record revisions.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::io;

const KEY: &str = "_atlasFormat";

#[derive(Clone, Copy)]
pub struct Format {
    pub kind: &'static str,
    pub revision: u32,
    /// Change when the meaning changes, even if the serialized shape still fits.
    pub semantics: &'static str,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    kind: String,
    revision: u32,
    semantics: String,
}

impl Format {
    pub fn write(&self, value: &impl Serialize) -> io::Result<Value> {
        let mut value = serde_json::to_value(value)?;
        value
            .as_object_mut()
            .ok_or_else(|| self.error("expected a record"))?
            .insert(
                KEY.into(),
                serde_json::to_value(Metadata {
                    kind: self.kind.into(),
                    revision: self.revision,
                    semantics: self.semantics.into(),
                })?,
            );
        Ok(value)
    }

    // owner-direction(2026-11-15): old data either works in the current format or does not load; no migrations
    pub fn read<T: DeserializeOwned>(&self, mut value: Value) -> io::Result<T> {
        let object = value
            .as_object_mut()
            .ok_or_else(|| self.error("expected a record"))?;
        if let Some(metadata) = object.remove(KEY) {
            let metadata: Metadata = serde_json::from_value(metadata).map_err(|e| self.error(e))?;
            if metadata.kind != self.kind || metadata.semantics != self.semantics {
                return Err(self.error("stored representation has incompatible meaning"));
            }
        }
        // Unstamped records and different revisions try the same current reader, never a converter.
        serde_json::from_value(value).map_err(|e| self.error(e))
    }

    pub fn parse<T: DeserializeOwned>(&self, text: &str) -> io::Result<T> {
        self.read(serde_json::from_str(text).map_err(|e| self.error(e))?)
    }

    pub fn text(&self, value: &impl Serialize) -> io::Result<String> {
        Ok(serde_json::to_string(&self.write(value)?)?)
    }

    fn error(&self, error: impl std::fmt::Display) -> io::Error {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Incompatible {} data: {error}", self.kind),
        )
    }
}

pub const MAP: Format = Format {
    kind: "map",
    revision: 1,
    semantics: "planar-metres-gis",
};
pub const VIEW: Format = Format {
    kind: "view",
    revision: 1,
    semantics: "map-owned-navigation",
};

pub fn read_map(value: Value) -> io::Result<atlas_map::MapDescriptor> {
    let map: atlas_map::MapDescriptor = MAP.read(value)?;
    map.validate().map_err(|e| MAP.error(e))?;
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Record {
        metres: f64,
    }

    #[test]
    fn current_reader_accepts_compatible_revisions_without_conversion() {
        let source = Record { metres: 12.0 };
        let old = Format { revision: 0, ..MAP }.write(&source).unwrap();
        assert_eq!(MAP.read::<Record>(old).unwrap(), source);
        assert_eq!(
            MAP.read::<Record>(serde_json::json!({"metres":12.0}))
                .unwrap(),
            source
        );
    }

    #[test]
    fn rejects_missing_required_data_and_incompatible_meaning() {
        assert!(MAP.read::<Record>(serde_json::json!({})).is_err());
        let old = Format {
            semantics: "feet",
            ..MAP
        }
        .write(&Record { metres: 12.0 })
        .unwrap();
        assert!(MAP.read::<Record>(old).is_err());
    }
}
