//! The map capability shared by SQLite/WASM and PostGIS hosts. It contains no private inputs.
use super::settlements::Settlement;
use super::{
    FeatureQuery, MapStore, Page, RegistryPage, RegistryRequest, RelatedMaps, SaveRequest,
    SavedMap, SavedMapDocument,
};
use crate::native_map_geometry::NativeMapGeometry;
use atlas_map::{
    HistoryEntry, MapDescriptor, MapEntity, MapFeature, MapRef, MapSample, Position,
    PublishedAsset, Publisher,
};
use std::io;

pub trait MapAccess: Publisher {
    fn geometry(&self) -> &NativeMapGeometry;
    fn open(&self, reference: &MapRef) -> io::Result<MapDescriptor>;
    fn find_head(&self, map_id: &str) -> io::Result<Option<MapRef>>;
    fn features(&self, reference: &MapRef, query: &FeatureQuery) -> io::Result<Page<MapFeature>>;
    fn entities(&self, reference: &MapRef, ids: &[String]) -> io::Result<Vec<MapEntity>>;
    fn history(
        &self,
        reference: &MapRef,
        cursor: &str,
        ids: Option<&[String]>,
    ) -> io::Result<Page<HistoryEntry>>;
    fn asset(&self, reference: &MapRef, id: &str) -> io::Result<PublishedAsset>;
    fn illustration_assets(&self, reference: &MapRef) -> io::Result<Vec<PublishedAsset>>;
    fn samples_at(
        &self,
        reference: &MapRef,
        space: &str,
        position: Position,
    ) -> io::Result<Vec<MapSample>>;
    fn registry(&self, reference: &MapRef, request: &RegistryRequest) -> io::Result<RegistryPage>;
    fn settlement(&self, reference: &MapRef, id: &str) -> io::Result<Option<Settlement>>;
    fn list_saved(&self, cursor: &str) -> io::Result<Page<SavedMap>>;
    fn find_saved(&self, map_id: &str) -> io::Result<Option<SavedMapDocument>>;
    fn open_saved(&self, map_id: &str) -> io::Result<SavedMapDocument> {
        self.find_saved(map_id)?
            .ok_or_else(|| io::Error::other("Saved map was not found"))
    }
    fn save(&self, request: SaveRequest, saved_at: String) -> io::Result<SavedMapDocument>;
    fn related(&self, reference: &MapRef) -> io::Result<RelatedMaps>;
}
impl MapAccess for MapStore {
    fn geometry(&self) -> &NativeMapGeometry {
        &self.geometry
    }
    fn open(&self, r: &MapRef) -> io::Result<MapDescriptor> {
        self.open(r)
    }
    fn find_head(&self, id: &str) -> io::Result<Option<MapRef>> {
        self.find_head(id)
    }
    fn features(&self, r: &MapRef, q: &FeatureQuery) -> io::Result<Page<MapFeature>> {
        self.features(r, q)
    }
    fn entities(&self, r: &MapRef, ids: &[String]) -> io::Result<Vec<MapEntity>> {
        self.entities(r, ids)
    }
    fn history(
        &self,
        r: &MapRef,
        cursor: &str,
        ids: Option<&[String]>,
    ) -> io::Result<Page<HistoryEntry>> {
        self.history(r, cursor, ids)
    }
    fn asset(&self, r: &MapRef, id: &str) -> io::Result<PublishedAsset> {
        self.asset(r, id)
    }
    fn illustration_assets(&self, r: &MapRef) -> io::Result<Vec<PublishedAsset>> {
        self.illustration_assets(r)
    }
    fn samples_at(&self, r: &MapRef, space: &str, p: Position) -> io::Result<Vec<MapSample>> {
        self.samples_at(r, space, p)
    }
    fn registry(&self, r: &MapRef, q: &RegistryRequest) -> io::Result<RegistryPage> {
        self.registry(r, q)
    }
    fn settlement(&self, r: &MapRef, id: &str) -> io::Result<Option<Settlement>> {
        self.settlement(r, id)
    }
    fn list_saved(&self, cursor: &str) -> io::Result<Page<SavedMap>> {
        self.list_saved(cursor)
    }
    fn find_saved(&self, id: &str) -> io::Result<Option<SavedMapDocument>> {
        self.find_saved(id)
    }
    fn save(&self, request: SaveRequest, time: String) -> io::Result<SavedMapDocument> {
        self.save(request, time)
    }
    fn related(&self, r: &MapRef) -> io::Result<RelatedMaps> {
        self.related(r)
    }
}
impl MapStore {
    pub fn access(&self) -> &dyn MapAccess {
        self
    }
    pub fn execute(&mut self, operation: super::Operation) -> io::Result<serde_json::Value> {
        (self as &mut dyn MapAccess).execute(operation)
    }
}
