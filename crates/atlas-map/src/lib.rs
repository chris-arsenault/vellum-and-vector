//! Published map values. This crate has no generation, storage or execution dependency.
// owner-direction(2026-11-12): map and generation use separate schemas
// Arconis: docs/architecture/subsystems.arconis#item=gis — published GIS layer, raster and record contracts.
pub mod authoring;
mod geometry;
pub mod hexes;
mod identity;
mod layers;
mod navigation;
mod people;
mod presentation;
mod publication;
mod records;
pub mod regions;
pub mod spatial;
mod spatial_query;
pub mod structure;
pub mod town;
pub mod underground;
mod validation;

pub use geometry::*;
pub use identity::*;
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
    pub map_id: Id,
    pub revision: Id,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapDescriptor {
    pub reference: MapRef,
    pub world_id: Id,
    pub name: String,
    pub primary_space_id: Id,
    pub profile: String,
    pub region_scale: RegionScale,
    /// Map-owned geography and its continuous opening window within the primary space.
    pub footprint: RegionGeometry,
    pub bounds: Bounds,
    pub spaces: Vec<MapSpace>,
    pub parent: Option<MapRef>,
    pub state: PublicationState,
    pub layers: Vec<MapLayer>,
    /// Present on real-scale maps: their hex grid and creator layers (ADR 0016).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub real_scale: Option<RealScale>,
}

/// What a real-scale map is: outdoor ground (caves included) or a building's floors.
/// `Authored` is a world, region or city map a creator starts blank and draws by hand
/// (ADR 0019): it carries the same editing block, creator layers and undo steps, but has no
/// hexes, so `across_flats` only sets the snapping tolerance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum RealScaleKind {
    Ground,
    Structure,
    Authored,
}

/// A real-scale map's hex grid. Hexes are pointy-topped; `origin` is one hex centre.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RealScale {
    pub kind: RealScaleKind,
    /// The creator's chosen hex size label, such as `1.5m`.
    pub hex_size: String,
    pub across_flats: f64,
    pub feet: f64,
    pub origin: [f64; 2],
    pub triangles_per_edge: u32,
    pub creator_layers: Vec<CreatorLayer>,
    /// Manual edits applied to the published layers. The first edit makes those layers the
    /// map's authority: generation no longer replaces an authored map (ADR 0016).
    // owner-direction(2026-11-16): when the user is authoring a map goes from the numerically in depth representation to a 2d representation of it
    #[serde(default)]
    pub edits: u32,
    /// On a structure map: the building on the parent map whose floors it holds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub site: Option<structure::StructureSite>,
    /// The hex classes and latent layers authoring offers and accepts on this map.
    #[serde(default)]
    pub authoring: authoring::AuthoringChoices,
}
impl RealScale {
    pub fn grid(&self) -> Result<hexes::HexGrid, &'static str> {
        hexes::HexGrid::from_across_flats(self.across_flats, self.origin)
    }
}

/// A named collection a creator makes on a real-scale map; features name theirs in
/// `creatorLayer`, and the first layer receives features that name none.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatorLayer {
    pub id: Id,
    pub name: String,
    /// A locked layer refuses pointer edits to its features; locking is shared, hiding is not.
    #[serde(default)]
    pub locked: bool,
}
impl CreatorLayer {
    /// The layer every real-scale map starts with.
    pub fn base() -> Self {
        Self {
            id: Id::from_name("base layer"),
            name: "Base layer".into(),
            locked: false,
        }
    }
}
impl RealScale {
    pub fn authored(&self) -> bool {
        self.edits > 0
    }
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
    pub space_id: Id,
    pub geometry: RegionGeometry,
    pub feature_ids: Vec<Id>,
    pub region_path: Vec<MapRegion>,
}

/// Generated declarations keep computational values shared without importing generation.
pub fn declarations() -> String {
    let cfg = ts_rs::Config::default();
    [
        serde_json::Value::decl(&cfg),
        MapRef::decl(&cfg),
        MapDescriptor::decl(&cfg),
        RealScaleKind::decl(&cfg),
        RealScale::decl(&cfg),
        CreatorLayer::decl(&cfg),
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
        KindSize::decl(&cfg),
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
        BandValue::decl(&cfg),
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
/// The real-scale editing, town and structure contracts, generated into their own file so
/// each generated file stays within the lint's size limit.
pub fn editing_declarations() -> String {
    let cfg = ts_rs::Config::default();
    [town::AddressMatch::decl(&cfg)]
        .into_iter()
        .chain(authoring::declarations(&cfg))
        .chain(structure::declarations(&cfg))
        .collect::<Vec<_>>()
        .join("\n\n")
        .replace("type ", "export type ")
}
