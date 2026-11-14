//! Map-only publication values, independent of numerical generation storage.
use crate::{HistoryEntry, MapDescriptor, MapEntity, MapFeature, MapLayer, MapRef, MapSample};
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishedAsset {
    pub id: String,
    pub media_type: String,
    pub location: String,
    pub byte_length: u64,
    pub illustration: bool,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationBatch {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub features: Vec<MapFeature>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<MapSample>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub entities: Vec<MapEntity>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<HistoryEntry>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<PublishedAsset>,
}
/// Owned by the selected execution host. Never made available to map presentation.
pub trait Publisher {
    fn begin(
        &mut self,
        map: &MapDescriptor,
        expected: Option<&MapRef>,
        progressive: bool,
    ) -> io::Result<()>;
    fn append(&mut self, reference: &MapRef, batch: PublicationBatch) -> io::Result<()>;
    fn add_layers(
        &mut self,
        reference: &MapRef,
        layers: &[MapLayer],
        asset: PublishedAsset,
    ) -> io::Result<()>;
    fn finish(&mut self, reference: &MapRef) -> io::Result<()>;
    fn discard(&mut self, reference: &MapRef) -> io::Result<()>;
}
