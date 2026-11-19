//! Independent GIS records. No generation resource capability is held by this store.
// owner-direction(2026-11-14): presentation reads only GIS storage, never numerical generation storage
// Arconis: docs/architecture/subsystems.arconis#item=sqlite — SQLite/GEOS map store used by the browser workspace.
mod access;
pub mod codec;
mod copy;
mod description;
mod edits;
mod export;
mod features;
mod interactions;
pub(crate) mod inventory;
pub(crate) mod library;
mod navigation;
mod operations;
mod publication;
mod queries;
mod records;
mod region_input;
mod registry;
mod registry_query;
pub(crate) mod samples;
mod settlements;
use crate::native_map_geometry::NativeMapGeometry;
use crate::sql::{column, Database};
pub use access::MapAccess;
use atlas_map::{Bounds, Id, MapDescriptor, MapRef, MapSpace};
pub use interactions::{InspectionRequest, SelectionRequest};
pub use inventory::MapEntry;
pub use library::{RelatedMaps, SaveRequest, SavedMap, SavedMapDocument};
pub use navigation::RegionOperation;
pub use operations::Operation;
pub use queries::{FeatureQuery, Page};
pub use registry::{Facets, RegistryRow, Scope, Sort};
pub use registry::{RegistryPage, RegistryRequest};
pub use registry_query::AttributeFilter;
pub use registry_query::RegistryQuery;
pub use settlements::Settlement;
use std::{io, rc::Rc};

pub struct EncodedGeometry {
    pub bytes: Vec<u8>,
    pub bounds: Bounds,
}
#[derive(Clone)]
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub struct MapStore {
    db: Rc<Database>,
    geometry: NativeMapGeometry,
    /// The publication being written, held between appends so each batch is checked
    /// against its layers without assembling the description again.
    open: Rc<std::cell::RefCell<Option<MapDescriptor>>>,
}
impl MapStore {
    pub fn open_database(db: Rc<Database>) -> io::Result<Self> {
        db.batch(include_str!("schema.sql"))?;
        Ok(Self {
            db,
            geometry: NativeMapGeometry,
            open: Rc::default(),
        })
    }
    pub fn open(&self, reference: &MapRef) -> io::Result<MapDescriptor> {
        self.read_description(reference).map(|(map, _)| map)
    }
    pub fn find_head(&self, map_id: Id) -> io::Result<Option<MapRef>> {
        self.db
            .value(
                "SELECT revision FROM map_heads WHERE map_id=?",
                &[map_id.into()],
            )?
            .map(|value| {
                Ok(MapRef {
                    map_id,
                    revision: value.id()?,
                })
            })
            .transpose()
    }
}
fn reference_values(reference: &MapRef) -> Vec<crate::sql::Value> {
    description::key(reference)
}
pub fn space(map: &MapDescriptor, id: Id) -> io::Result<&MapSpace> {
    map.spaces
        .iter()
        .find(|space| space.id == id)
        .ok_or_else(|| io::Error::other("Coordinate space was not found in this map"))
}
