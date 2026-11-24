//! One generation run's records and owner packages. Map readers receive only published products.
mod caves;
mod checkpoint;
mod checkpoint_records;
mod ecology;
mod effects;
mod extraction;
mod geography;
mod landmark_history;
mod landmarks;
mod lifecycle;
mod magic_current;
mod magic_material;
mod native;
mod oceans;
mod publication;
mod reads;
mod real_scale_ground;
mod real_scale_trails;
mod real_scale_water;
mod regional_causes;
mod regional_climate;
mod regional_ecology;
mod regional_ground;
mod regional_initialization;
mod regional_people;
mod regional_water;
mod rivers;
mod settings;
mod settlements;
mod travel;
use crate::{
    execution::Executor,
    features::{
        network::NetworkWorkspace, publication::Named, records::Attributes, Feature, FeatureReader,
        FeatureWorkspace,
    },
    field::{
        self,
        people::{
            events::Events, place_country::KnownWay, place_land::PlaceLand, places::Places,
            traditions, works::Works,
        },
        poi::{catalogue::Catalogue, fall_size::Sizes, state::Held, variety::Varieties},
        projection::Surface,
        refinement::{
            causes::{Evidence, Schedule},
            network::Network,
            river_lineage::ContinuingRiver,
        },
        Field,
    },
    magic::workspace::Workspace as Magic,
    spatial::SpatialKernel,
    storage::ReadBand,
};
use atlas_map::{Bounds, Geometry};
pub use ecology::{EcologicalWork, EcologyPhase};
pub use extraction::{Deliveries, GeographicPublication};
pub use regional_ecology::RegionalEcology;
pub use regional_initialization::CapturedRegion;
pub use regional_people::RegionalRecording;
pub use settings::Settings;
// hpc-exempt: world record identities, settings and publication metadata; fields remain typed bands.
use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    io,
    rc::Rc,
};

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub world: atlas_map::Id,
    pub area: atlas_map::Id,
    pub area_name: String,
    pub space: atlas_map::Id,
    pub world_geography: bool,
    pub owns_map_geography: bool,
    // hpc-exempt: captured area ancestry, not cell membership.
    pub area_parents: BTreeMap<atlas_map::Id, Option<atlas_map::Id>>,
    pub domain: Geometry,
    pub domain_bounds: Bounds,
    /// What the map generates over: its outline and the context band round it.
    pub footprint: Geometry,
    /// The map's published outline, where a refined map works a context band beyond it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<Geometry>,
    pub cylindrical: bool,
    pub has_boundary: bool,
    pub precision: f64,
    // hpc-exempt: generation domains keyed by layer identity.
    pub generation_domains: BTreeMap<String, String>,
    // hpc-exempt: captured feature contracts, not cell membership.
    pub contracted: BTreeSet<atlas_map::Id>,
    /// A real-scale map's captured choices (ADR 0016); none on world and regional maps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub real_scale: Option<crate::features::context::RealScaleMap>,
    /// A city map's settlement; none on other maps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub city: Option<crate::features::context::CityRefinement>,
}
impl Scope {
    pub(crate) fn settled_outline(&self) -> &Geometry {
        self.city
            .as_ref()
            .and_then(|city| city.settled_outline.as_ref())
            .or(self.outline.as_ref())
            .unwrap_or(&self.footprint)
    }

    pub(crate) fn process_map_type(&self) -> crate::processes::strategies::MapType {
        use crate::processes::strategies::MapType;

        if self.world_geography {
            MapType::World
        } else if self.city.is_some() {
            MapType::City
        } else if self.real_scale.is_some() {
            MapType::Street
        } else {
            MapType::Region
        }
    }

    pub fn validate_ancestry(&self) -> io::Result<()> {
        for &area in self.area_parents.keys() {
            let mut seen = BTreeSet::new();
            let mut next = Some(area);
            while let Some(id) = next {
                if !seen.insert(id) {
                    return Err(io::Error::other("Geographic ancestry contains a cycle"));
                }
                next = self.area_parents.get(&id).copied().flatten();
            }
        }
        Ok(())
    }
    pub fn is_descendant(&self, child: atlas_map::Id, ancestor: atlas_map::Id) -> bool {
        let mut next = Some(child);
        while let Some(id) = next {
            if id == ancestor {
                return true;
            }
            next = self.area_parents.get(&id).copied().flatten();
        }
        false
    }
}
pub struct Records {
    pub features: Box<dyn FeatureWorkspace>,
    pub source_features: Option<Box<dyn FeatureReader>>,
    pub networks: Box<dyn NetworkWorkspace>,
    // hpc-exempt: retained feature-name metadata keyed by stable identity.
    pub retained_names: BTreeMap<atlas_map::Id, Named>,
}
pub struct PeopleRecords {
    pub places: Rc<RefCell<Places>>,
    pub ways: Rc<RefCell<Vec<KnownWay>>>,
    pub events: Rc<RefCell<Events>>,
    pub works: Rc<RefCell<Works>>,
    pub memory: Rc<RefCell<traditions::Context>>,
}
/// Existing naming behavior remains a host capability used at record boundaries.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct InhabitedName {
    pub named: Named,
    pub language: Option<String>,
}
pub trait Naming {
    /// The existing name-forge stream chooses a language using these local speaker weights.
    fn inhabited_feature(
        &self,
        scope: &Scope,
        feature: &Feature,
        speakers: &[(String, f64)],
        era: &str,
    ) -> io::Result<Option<InhabitedName>>;
    fn magic_landmark(
        &self,
        scope: &Scope,
        landmark: &field::landmarks::catalogue::Landmark,
        term: &str,
        position: [f64; 2],
    ) -> io::Result<Option<Named>>;
    fn geographic(
        &self,
        scope: &Scope,
        key: &str,
        kind: &str,
        geometry: &Geometry,
        attributes: &Attributes,
    ) -> io::Result<Option<Named>>;
    fn feature(&self, scope: &Scope, feature: &Feature) -> io::Result<Option<Named>>;
    /// A settlement's own work (a street, ward, household or business) named in that
    /// settlement's naming culture, with the work's term such as Lane or Arms.
    fn work(
        &self,
        scope: &Scope,
        key: &str,
        work: &str,
        position: [f64; 2],
        culture: Option<&str>,
    ) -> io::Result<Named>;
    fn community(
        &self,
        scope: &Scope,
        place: &field::people::places::Place,
        land: &PlaceLand,
        language: Option<&str>,
    ) -> io::Result<Named>;
}
pub struct Physical {
    pub protection: Rc<field::protection::Protection>,
    pub executor: Executor<Field>,
    pub surface: Surface,
    pub field_footprint: Geometry,
    pub active: ReadBand<u8>,
    pub ocean: Option<Geometry>,
    pub lakes: Vec<LakeSurface>,
    // hpc-exempt: one geometric outline per water body, not numeric field storage.
    pub lake_outlines: BTreeMap<i32, Geometry>,
    pub magic: Option<RefCell<Magic>>,
    pub landmarks: Vec<field::landmarks::catalogue::Landmark>,
    pub landmark_roster: Option<Vec<field::landmarks::roster::Entry>>,
    pub settings: Settings,
}
#[derive(serde::Serialize, serde::Deserialize)]
pub struct LakeSurface {
    pub id: atlas_map::Id,
    pub geometry: Geometry,
    pub level: f64,
}
pub struct Regional {
    pub domains: Vec<String>,
    pub parent_span: f64,
    pub inherited_height: ReadBand<f64>,
    pub round: usize,
    pub evidence: Evidence,
    pub network: Option<Network>,
    pub basin: Option<Vec<u8>>,
    pub continuing_rivers: Option<Vec<ContinuingRiver>>,
    pub character: Option<field::refinement::character::Character>,
    pub contacts: Vec<crate::rock::ground::contacts::Plan>,
    pub drainage: RefCell<Option<field::refinement::divides::Drainage>>,
    pub climate: Option<field::climate::regional::Capture>,
    pub small_channel_length: Option<ReadBand<f64>>,
    pub media: RefCell<Option<field::refinement::media::Media>>,
    pub contributions: field::contributions::Contributions,
    // hpc-exempt: identities of earlier generated records removed from this map.
    pub removed_products: BTreeSet<atlas_map::Id>,
    /// A city map's own state: its template and the walls it has raised.
    pub city: City,
}
/// A city map's template, chosen at its first growth round; the walls it raises; its hot-spot
/// towns' cells and the prominent places those towns have built, renewed every round; its
/// major works, sited in its first round; and the districts cut after its last.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct City {
    #[serde(default)]
    pub urban: crate::processes::town::urban::Urban,
    pub template: Option<crate::town::templates::Selection>,
    pub walls: Vec<crate::town::walls::Wall>,
    pub works: Vec<(crate::town::catalogue::works::WorkFamily, u32)>,
}
impl Regional {
    pub fn new(field: &Field, domains: Vec<String>, parent_span: f64) -> io::Result<Self> {
        Ok(Self {
            domains,
            parent_span,
            inherited_height: field.captured_height()?,
            round: 0,
            evidence: Evidence::default(),
            network: None,
            basin: None,
            continuing_rivers: None,
            character: None,
            contacts: Vec::new(),
            drainage: RefCell::default(),
            climate: None,
            small_channel_length: None,
            media: RefCell::default(),
            contributions: Default::default(),
            // hpc-exempt: removed record identities, not numerical membership.
            removed_products: BTreeSet::new(),
            city: City::default(),
        })
    }
}
pub struct State {
    pub town: crate::town::fabric::Fabric,
    pub scope: Scope,
    pub physical: Physical,
    pub records: Records,
    pub people: PeopleRecords,
    pub regional: Option<Regional>,
    pub spatial: Rc<dyn SpatialKernel>,
    pub naming: Rc<dyn Naming>,
    pub catalogue: Rc<Catalogue<Self, Schedule<Self>>>,
    pub history: Vec<super::history::EpochHistory>,
    pub causes: Vec<super::history::Cause>,
    pub diagnostics: Vec<super::history::Diagnostic>,
    pub drainage: Option<crate::water::captured::DrainageNetwork>,
    pub retained_continental_domains: Cell<usize>,
    /// Counts mutable field access through the map's field projection. With the physical
    /// executor's revision it tells a reader whether the field may have changed.
    pub field_writes: Cell<u64>,
    held: Held,
    varieties: Varieties,
    fall_sizes: Sizes,
    place_effects: effects::Memory,
}
pub struct Services {
    pub spatial: Rc<dyn SpatialKernel>,
    pub naming: Rc<dyn Naming>,
}
impl State {
    pub fn new(
        scope: Scope,
        physical: Physical,
        records: Records,
        people: PeopleRecords,
        services: Services,
    ) -> io::Result<Self> {
        let catalogue = Rc::new(publication::catalogue(settlements::schedule())?);
        let place_effects = effects::Memory::new(physical.executor.state());
        Ok(Self {
            town: crate::town::fabric::Fabric::default(),
            scope,
            physical,
            records,
            people,
            regional: None,
            spatial: services.spatial,
            naming: services.naming,
            catalogue,
            history: Vec::new(),
            causes: Vec::new(),
            diagnostics: Vec::new(),
            drainage: None,
            retained_continental_domains: Cell::new(0),
            field_writes: Cell::new(0),
            held: Held::default(),
            varieties: Varieties::default(),
            fall_sizes: Sizes::default(),
            place_effects,
        })
    }
    pub fn field(&self) -> &Field {
        self.physical.executor.state()
    }
    /// Changes whenever the field may have been written: through the physical executor
    /// or through the map's field projection.
    pub fn field_version(&self) -> (u64, u64) {
        (self.physical.executor.revision(), self.field_writes.get())
    }
    pub fn clear_queries(&self) {
        self.held.release();
    }
}
