//! Generation contracts and computation. Published maps remain independent of this crate.
pub mod answers;
pub mod atlas;
pub mod bindings;
pub mod climate;
pub mod composition;
pub mod contours;
pub mod control;
pub mod ecology;
pub mod execution;
pub mod features;
pub mod field;
pub mod flow_graph;
pub mod hpc;
pub mod human;
pub mod identity;
pub mod lattice;
pub mod links;
pub mod magic;
pub mod metric;
pub mod naming;
pub mod noise;
pub mod parameters;
pub mod processes;
pub mod products;
pub mod prominence;
pub mod publication;
pub mod recipe;
pub mod reconstruction;
pub mod rock;
pub mod scale;
pub mod scale_settings;
pub mod sequence;
pub mod settlement;
pub mod spatial;
pub mod storage;
pub mod tectonics;
pub mod transport;
pub mod water;

use atlas_map::{MapRef, RegionSelection};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Captured inputs live on the selected execution host, never in the map reader.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefinementRequest<Configuration> {
    pub selection: RegionSelection,
    pub configuration: Configuration,
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

impl<Configuration> RefinementRequest<Configuration> {
    pub fn require_parent(&self, available: &MapRef) -> Result<(), atlas_map::MapError> {
        self.selection.parent.require_revision(available)
    }
}

pub fn declarations() -> String {
    use magic::{configuration as m, confluences::configuration as c};
    let cfg = ts_rs::Config::default();
    [
        RefinementRequest::<()>::decl(&cfg),
        GenerationState::decl(&cfg),
        GenerationStatus::decl(&cfg),
        control::GenerationProgress::decl(&cfg),
        publication::raster::RasterGrid::decl(&cfg),
        publication::raster::Resampling::decl(&cfg),
        publication::upload::PublicationPlane::decl(&cfg),
        publication::upload::RasterPublicationInput::decl(&cfg),
        atlas::context::Epoch::decl(&cfg),
        atlas::context::EcologyEpoch::decl(&cfg),
        atlas::context::HumanEra::decl(&cfg),
        atlas::context::RelativeUnits::decl(&cfg),
        atlas::dispatch::preflight::Diagnostic::decl(&cfg),
        atlas::dispatch::preflight::ConfigurationField::decl(&cfg),
        atlas::history::Severity::decl(&cfg),
        field::landmarks::catalogue::Landmark::decl(&cfg),
        field::landmarks::catalogue::Kind::decl(&cfg),
        field::landmarks::magic::Position::decl(&cfg),
        field::landmarks::magic::Source::decl(&cfg),
        m::Source::decl(&cfg),
        m::Propagation::decl(&cfg),
        m::Renewal::decl(&cfg),
        m::Carrier::decl(&cfg),
        m::Phase::decl(&cfg),
        m::Stock::decl(&cfg),
        m::Origin::decl(&cfg),
        m::Condition::decl(&cfg),
        m::Coverage::decl(&cfg),
        m::Cartography::decl(&cfg),
        m::Feature::decl(&cfg),
        m::Effects::decl(&cfg),
        m::History::decl(&cfg),
        m::Relative::decl(&cfg),
        m::System::decl(&cfg),
        magic::parameters::Parameters::decl(&cfg),
        // The parameters! macro gives Overrides exactly Parameters' fields, all optional.
        format!(
            "type {} = Partial<{}>;",
            magic::parameters::Overrides::name(&cfg),
            magic::parameters::Parameters::name(&cfg),
        ),
        c::Effects::decl(&cfg),
        c::Hazard::decl(&cfg),
        c::GroundMaterial::decl(&cfg),
        c::Confluence::decl(&cfg),
    ]
    .join("\n\n")
    .replace("type ", "export type ")
}
