use crate::{Bounds, MapDescriptor, MapRef, PublicationState};
use serde::{Deserialize, Serialize};
use std::fmt;
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum MapErrorCode {
    InvalidMap,
    RevisionConflict,
    IncompleteMap,
    NotFound,
    Cancelled,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapError {
    pub code: MapErrorCode,
    pub message: String,
}

impl MapError {
    pub fn new(code: MapErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl fmt::Display for MapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.message.fmt(f)
    }
}
impl std::error::Error for MapError {}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "status", content = "value", rename_all = "camelCase")]
pub enum MapValidation {
    Valid(MapDescriptor),
    Invalid(MapError),
}

impl Bounds {
    pub fn validate(&self) -> Result<(), MapError> {
        if [self.0, self.1, self.2, self.3]
            .iter()
            .all(|v| v.is_finite())
            && self.2 > self.0
            && self.3 > self.1
        {
            return Ok(());
        }
        Err(MapError::new(
            MapErrorCode::InvalidMap,
            "Map bounds must have finite positive extent",
        ))
    }
}

impl MapRef {
    pub fn validate(&self) -> Result<(), MapError> {
        if self.map_id.is_empty() || self.revision.is_empty() {
            return Err(MapError::new(
                MapErrorCode::InvalidMap,
                "A map needs identity and revision",
            ));
        }
        Ok(())
    }

    pub fn require_revision(&self, expected: &Self) -> Result<(), MapError> {
        self.validate()?;
        expected.validate()?;
        if self != expected {
            return Err(MapError::new(
                MapErrorCode::RevisionConflict,
                "The selected map revision is unavailable",
            ));
        }
        Ok(())
    }
}

impl MapDescriptor {
    pub fn validate(&self) -> Result<(), MapError> {
        self.reference.validate()?;
        self.space.bounds.validate()?;
        if self.world_id.is_empty()
            || self.name.is_empty()
            || self.space.id.is_empty()
            || self.space.metres_per_unit != 1.0
            || self
                .space
                .periodic_width
                .is_some_and(|v| !v.is_finite() || v <= 0.0)
        {
            return Err(MapError::new(
                MapErrorCode::InvalidMap,
                "Maps need named planar metre coordinates",
            ));
        }
        if let Some(parent) = &self.parent {
            parent.validate()?;
        }
        let mut ids = std::collections::BTreeSet::new();
        for layer in &self.layers {
            layer.validate()?;
            if !ids.insert(&layer.id) {
                return Err(MapError::new(
                    MapErrorCode::InvalidMap,
                    "Map layer identities must be distinct",
                ));
            }
        }
        Ok(())
    }

    pub fn require_complete(&self) -> Result<(), MapError> {
        self.validate()?;
        if self.state != PublicationState::Complete {
            return Err(MapError::new(
                MapErrorCode::IncompleteMap,
                "Incomplete maps cannot be saved as finished maps",
            ));
        }
        Ok(())
    }
}
