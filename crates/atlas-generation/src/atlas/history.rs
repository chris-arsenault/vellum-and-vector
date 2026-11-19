//! Completed causal history, separate from execution state and present geography.
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct GeographicObservation {
    pub id: atlas_map::Id,
    pub name: String,
    pub geometry: Geometry,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct FieldSummary {
    pub unit: String,
    pub minimum: f64,
    pub maximum: f64,
    pub mean: f64,
}
#[derive(Clone, Serialize, Deserialize)]
pub enum VolumeUnit {
    #[serde(rename = "cubic-metre")]
    CubicMetre,
}
#[derive(Clone, Serialize, Deserialize)]
pub enum FlowUnit {
    #[serde(rename = "cubic-metre/second")]
    CubicMetrePerSecond,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Cause {
    Geography {
        process: String,
        feature_kind: String,
        observations: Vec<GeographicObservation>,
    },
    Climate {
        process: String,
        // hpc-exempt: summaries keyed by declared field names, not numerical cell storage.
        fields: std::collections::BTreeMap<String, FieldSummary>,
    },
    Material {
        process: String,
        eroded: f64,
        deposited: f64,
        exported: f64,
        unit: VolumeUnit,
    },
    Drainage {
        process: String,
        runoff: f64,
        outflow: f64,
        unit: FlowUnit,
    },
    Ice {
        process: String,
        accumulation: f64,
        meltwater: f64,
        remaining: f64,
        unit: VolumeUnit,
    },
    Magic {
        process: String,
        source_id: atlas_map::Id,
        activity: f64,
        forcing: FieldSummary,
        stored: FieldSummary,
    },
    Domain {
        process: String,
        subjects: Vec<atlas_map::Id>,
        description: String,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationEpoch {
    pub id: String,
    pub duration: f64,
    pub parent_epoch: Option<String>,
    pub variables: serde_json::Map<String, serde_json::Value>,
}
// Arconis: docs/architecture/subsystems.arconis#item=carry — holds the state carried forward from one epoch to the next.
#[derive(Clone, Serialize, Deserialize)]
pub struct EpochHistory {
    pub path: Vec<String>,
    pub ancestry: Vec<GenerationEpoch>,
    pub causes: Vec<Cause>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedGenerationHistory {
    pub run_id: String,
    pub area_id: String,
    pub entries: Vec<EpochHistory>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub severity: Severity,
    pub invocation: String,
    pub resource: Option<String>,
    pub process: String,
    pub epochs: Vec<GenerationEpoch>,
    pub outcome: Outcome,
}
#[derive(Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Failed,
    Omitted,
    Skipped,
    Retained,
}
