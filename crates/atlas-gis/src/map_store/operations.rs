use super::{
    FeatureQuery, InspectionRequest, MapAccess, RegistryRequest, SaveRequest, SelectionRequest,
};
use atlas_map::{
    MapDescriptor, MapLayer, MapNavigationState, MapRef, NavigationChange, Position,
    PublicationBatch, PublishedAsset,
};
use serde::Deserialize;
use serde_json::Value;
use std::io;
#[derive(Deserialize)]
#[serde(
    tag = "method",
    content = "params",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Operation {
    Head {
        map_id: String,
    },
    Open {
        reference: MapRef,
    },
    FindHead {
        map_id: String,
    },
    Features {
        reference: MapRef,
        query: FeatureQuery,
    },
    Entities {
        reference: MapRef,
        ids: Vec<String>,
    },
    History {
        reference: MapRef,
        cursor: Option<String>,
        feature_ids: Option<Vec<String>>,
    },
    Asset {
        reference: MapRef,
        id: String,
    },
    IllustrationAssets {
        reference: MapRef,
    },
    SamplesAt {
        reference: MapRef,
        space_id: String,
        position: Position,
    },
    Inspect {
        reference: MapRef,
        request: InspectionRequest,
    },
    SelectRegion {
        reference: MapRef,
        request: SelectionRequest,
    },
    Registry {
        reference: MapRef,
        request: RegistryRequest,
    },
    Settlement {
        reference: MapRef,
        id: String,
    },
    ListSaved {
        cursor: Option<String>,
    },
    OpenSaved {
        map_id: String,
    },
    FindSaved {
        map_id: String,
    },
    Save {
        request: SaveRequest,
        saved_at: String,
    },
    Related {
        reference: MapRef,
    },
    ReadNavigation {
        reference: MapRef,
    },
    CommitNavigation {
        reference: MapRef,
        state: MapNavigationState,
        change: NavigationChange,
    },
    Begin {
        map: Box<MapDescriptor>,
        expected: Option<MapRef>,
        progressive: bool,
    },
    Append {
        reference: MapRef,
        batch: PublicationBatch,
    },
    AddLayers {
        reference: MapRef,
        layers: Vec<MapLayer>,
        asset: PublishedAsset,
    },
    Finish {
        reference: MapRef,
    },
    Discard {
        reference: MapRef,
    },
}
impl dyn MapAccess + '_ {
    pub fn execute(&mut self, operation: Operation) -> io::Result<Value> {
        use Operation::*;
        match operation {
            Head { map_id } => encode(
                self.find_head(&map_id)?
                    .ok_or_else(|| io::Error::other("Map was not found"))?,
            ),
            Open { reference } => encode(self.open(&reference)?),
            FindHead { map_id } => encode(self.find_head(&map_id)?),
            Features { reference, query } => encode(self.features(&reference, &query)?),
            Entities { reference, ids } => encode(self.entities(&reference, &ids)?),
            History {
                reference,
                cursor,
                feature_ids,
            } => encode(self.history(
                &reference,
                cursor.as_deref().unwrap_or_default(),
                feature_ids.as_deref(),
            )?),
            Asset { reference, id } => encode(self.asset(&reference, &id)?),
            IllustrationAssets { reference } => encode(self.illustration_assets(&reference)?),
            SamplesAt {
                reference,
                space_id,
                position,
            } => encode(self.samples_at(&reference, &space_id, position)?),
            Inspect { reference, request } => encode(self.inspect(&reference, &request)?),
            SelectRegion { reference, request } => {
                encode(self.select_region(&reference, &request)?)
            }
            Registry { reference, request } => encode(self.registry(&reference, &request)?),
            Settlement { reference, id } => encode(self.settlement(&reference, &id)?),
            ListSaved { cursor } => encode(self.list_saved(cursor.as_deref().unwrap_or_default())?),
            OpenSaved { map_id } => encode(self.open_saved(&map_id)?),
            FindSaved { map_id } => encode(self.find_saved(&map_id)?),
            Save { request, saved_at } => encode(self.save(request, saved_at)?),
            Related { reference } => encode(self.related(&reference)?),
            ReadNavigation { reference } => encode(self.read_navigation(&reference)?),
            CommitNavigation {
                reference,
                state,
                change,
            } => encode(self.commit_navigation(&reference, &state, change)?),
            Begin {
                map,
                expected,
                progressive,
            } => encode(self.begin(&map, expected.as_ref(), progressive)?),
            Append { reference, batch } => encode(self.append(&reference, batch)?),
            AddLayers {
                reference,
                layers,
                asset,
            } => encode(self.add_layers(&reference, &layers, asset)?),
            Finish { reference } => encode(self.finish(&reference)?),
            Discard { reference } => encode(self.discard(&reference)?),
        }
    }
}
fn encode(value: impl serde::Serialize) -> io::Result<Value> {
    serde_json::to_value(value).map_err(io::Error::other)
}
