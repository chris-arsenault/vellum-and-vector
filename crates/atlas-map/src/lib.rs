//! Published map values. This crate has no generation, storage or execution dependency.
mod geometry;
mod layers;
mod records;
mod validation;

pub use geometry::*;
pub use layers::*;
pub use records::*;
pub use validation::*;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapRef {
    pub map_id: String,
    pub revision: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapDescriptor {
    pub reference: MapRef,
    pub world_id: String,
    pub name: String,
    pub space: MapSpace,
    pub parent: Option<MapRef>,
    pub state: PublicationState,
    pub layers: Vec<MapLayer>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PublicationState {
    Incomplete,
    Complete,
}

/// A selection is canonical geography, independent of clipped display fragments.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionSelection {
    pub parent: MapRef,
    pub space_id: String,
    pub geometry: RegionGeometry,
    pub feature_ids: Vec<String>,
}

/// Generated declarations keep computational values shared without importing generation.
pub fn declarations() -> String {
    [
        MapRef::decl(),
        MapDescriptor::decl(),
        PublicationState::decl(),
        Position::decl(),
        Bounds::decl(),
        MapSpace::decl(),
        Geometry::decl(),
        RegionGeometry::decl(),
        RegionSelection::decl(),
        MapLayer::decl(),
        LayerSource::decl(),
        RasterSource::decl(),
        RasterBand::decl(),
        VectorSource::decl(),
        Category::decl(),
        MapFeature::decl(),
        Inspection::decl(),
        SampleValue::decl(),
        InspectionSection::decl(),
        HistoryEntry::decl(),
        MapError::decl(),
        MapErrorCode::decl(),
        MapValidation::decl(),
    ]
    .join("\n\n")
    .replace("type ", "export type ")
}
