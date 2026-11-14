use super::PostgresMaps;
use crate::map_store::{
    FeatureQuery, MapAccess, Operation, Page, RegistryPage, RegistryRequest, RelatedMaps,
    SaveRequest, SavedMap, SavedMapDocument, Settlement,
};
use crate::native_map_geometry::NativeMapGeometry;
use atlas_map::{
    HistoryEntry, MapDescriptor, MapEntity, MapFeature, MapRef, MapSample, Position, PublishedAsset,
};
use std::io;
impl MapAccess for PostgresMaps {
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

impl PostgresMaps {
    pub fn access(&self) -> &dyn MapAccess {
        self
    }
    pub fn call(&mut self, operation: Operation) -> io::Result<serde_json::Value> {
        (self as &mut dyn MapAccess).execute(operation)
    }
}
