//! Generation contracts and computation. Published maps remain independent of this crate.
pub mod hpc;

use atlas_map::{MapRef, RegionSelection};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Captured inputs live on the selected execution host, never in the map reader.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefinementRequest {
    pub selection: RegionSelection,
    pub configuration_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum GenerationState {
    Running,
    Completed,
    Cancelled,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerationStatus {
    pub job_id: String,
    pub state: GenerationState,
    pub step: String,
    pub progress: Option<f64>,
    pub result: Option<MapRef>,
    pub message: Option<String>,
}

impl RefinementRequest {
    pub fn require_parent(&self, available: &MapRef) -> Result<(), atlas_map::MapError> {
        self.selection.parent.require_revision(available)
    }
}

pub fn declarations() -> String {
    [
        RefinementRequest::decl(),
        GenerationState::decl(),
        GenerationStatus::decl(),
    ]
    .join("\n\n")
    .replace("type ", "export type ")
}
