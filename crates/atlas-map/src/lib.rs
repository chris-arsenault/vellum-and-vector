//! Published map values. This crate has no generation, storage or execution dependency.
// owner-direction(2026-11-12): map and generation use separate schemas
// Arconis: docs/architecture/subsystems.arconis#item=gis — published GIS layer, raster and record contracts.
mod geometry;
mod layers;
mod navigation;
mod people;
mod presentation;
mod publication;
mod records;
pub mod regions;
pub mod spatial;
mod spatial_query;
mod validation;

pub use geometry::*;
pub use layers::*;
pub use navigation::*;
pub use people::*;
pub use presentation::*;
pub use publication::*;
pub use records::*;
pub use spatial_query::*;
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
    pub primary_space_id: String,
    pub profile: String,
    pub region_scale: RegionScale,
    /// Map-owned geography and its continuous opening window within the primary space.
    pub footprint: RegionGeometry,
    pub bounds: Bounds,
    pub spaces: Vec<MapSpace>,
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
    pub region_path: Vec<MapRegion>,
}

/// Generated declarations keep computational values shared without importing generation.
pub fn declarations() -> String {
    let cfg = ts_rs::Config::default();
    [
        serde_json::Value::decl(&cfg),
        MapRef::decl(&cfg),
        MapDescriptor::decl(&cfg),
        RegionScale::decl(&cfg),
        MapRegion::decl(&cfg),
        MapView::decl(&cfg),
        MapNavigationState::decl(&cfg),
        NavigationChange::decl(&cfg),
        RegionQuery::decl(&cfg),
        RegionCandidate::decl(&cfg),
        RegionChoices::decl(&cfg),
        RegionDrawing::decl(&cfg),
        RegionDrawingResult::decl(&cfg),
        regions::RegionInput::decl(&cfg),
        PublicationState::decl(&cfg),
        Position::decl(&cfg),
        Bounds::decl(&cfg),
        MapSpace::decl(&cfg),
        MapFrame::decl(&cfg),
        Geometry::decl(&cfg),
        GeometryQuery::decl(&cfg),
        GeometryResult::decl(&cfg),
        CoverageRequest::decl(&cfg),
        RegionGeometry::decl(&cfg),
        RegionSelection::decl(&cfg),
        MapLayer::decl(&cfg),
        LayerCatalog::decl(&cfg),
        DisplayUnit::decl(&cfg),
        MapFeatureType::decl(&cfg),
        MagicDepiction::decl(&cfg),
        GeometryType::decl(&cfg),
        PropertyType::decl(&cfg),
        MapProperty::decl(&cfg),
        MapVectorStyle::decl(&cfg),
        MapFeatureTypeStyle::decl(&cfg),
        LayerSource::decl(&cfg),
        RasterSource::decl(&cfg),
        RasterBand::decl(&cfg),
        VectorSource::decl(&cfg),
        AttributeSource::decl(&cfg),
        Category::decl(&cfg),
        SurfaceAppearance::decl(&cfg),
        MapFeature::decl(&cfg),
        MapFeatureCatalog::decl(&cfg),
        MapColumn::decl(&cfg),
        MapEntity::decl(&cfg),
        LanguageShare::decl(&cfg),
        PopulationGroup::decl(&cfg),
        MapRelation::decl(&cfg),
        IllustrationGeometry::decl(&cfg),
        Inspection::decl(&cfg),
        SampleValue::decl(&cfg),
        SampleAttribute::decl(&cfg),
        MapSample::decl(&cfg),
        SampleWindow::decl(&cfg),
        InspectionSection::decl(&cfg),
        HistoryEntry::decl(&cfg),
        MapError::decl(&cfg),
        MapErrorCode::decl(&cfg),
        MapValidation::decl(&cfg),
    ]
    .join("\n\n")
    .replace("type ", "export type ")
}
