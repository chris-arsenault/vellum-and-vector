//! Independent GIS records. No generation resource capability is held by this store.
// owner-direction(2026-11-14): presentation reads only GIS storage, never numerical generation storage
mod access;
pub mod codec;
mod copy;
mod export;
mod interactions;
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
use crate::sql::{column, Database, Value};
pub use access::MapAccess;
use atlas_map::{Bounds, MapDescriptor, MapRef, MapSpace};
pub use interactions::{InspectionRequest, SelectionRequest};
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
}
impl MapStore {
    pub fn open_database(db: Rc<Database>) -> io::Result<Self> {
        db.batch(include_str!("schema.sql"))?;
        Ok(Self {
            db,
            geometry: NativeMapGeometry,
        })
    }
    pub fn open(&self, reference: &MapRef) -> io::Result<MapDescriptor> {
        let value = self
            .db
            .value(
                "SELECT descriptor FROM maps WHERE map_id=? AND revision=?",
                &reference_values(reference),
            )?
            .ok_or_else(|| io::Error::other("Map revision was not found"))?;
        serde_json::from_str(value.text()?).map_err(io::Error::other)
    }
    pub fn find_head(&self, map_id: &str) -> io::Result<Option<MapRef>> {
        self.db
            .value(
                "SELECT revision FROM map_heads WHERE map_id=?",
                &[map_id.into()],
            )?
            .map(|value| {
                Ok(MapRef {
                    map_id: map_id.into(),
                    revision: value.text()?.into(),
                })
            })
            .transpose()
    }
}
fn reference_values(reference: &MapRef) -> Vec<Value> {
    vec![
        reference.map_id.clone().into(),
        reference.revision.clone().into(),
    ]
}
pub fn space<'a>(map: &'a MapDescriptor, id: &str) -> io::Result<&'a MapSpace> {
    map.spaces
        .iter()
        .find(|space| space.id == id)
        .ok_or_else(|| io::Error::other("Coordinate space was not found in this map"))
}
fn json(value: &impl serde::Serialize) -> io::Result<Value> {
    Ok(serde_json::to_string(value)
        .map_err(io::Error::other)?
        .into())
}
