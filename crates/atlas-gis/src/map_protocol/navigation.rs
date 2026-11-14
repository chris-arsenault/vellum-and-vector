use super::read::reference;
use crate::{
    map_files::MapFiles,
    map_store::{codec, MapAccess, RegionOperation},
};
use atlas_map::{MapNavigationState, MapRef, NavigationChange, RegionDrawing, RegionQuery};
use serde::Deserialize;
use std::io;
#[derive(Deserialize)]
#[serde(tag = "method", content = "args", rename_all = "camelCase")]
pub enum NavigationCall {
    Read((MapRef,)),
    Commit(MapRef, MapNavigationState, NavigationChange),
    Choices(MapRef, MapNavigationState, RegionQuery),
    Draw(MapRef, MapNavigationState, RegionDrawing),
}
impl NavigationCall {
    pub fn reference(&self) -> &MapRef {
        match self {
            Self::Read((r,))
            | Self::Commit(r, _, _)
            | Self::Choices(r, _, _)
            | Self::Draw(r, _, _) => r,
        }
    }
    pub async fn execute(self, maps: &dyn MapAccess, files: &MapFiles) -> io::Result<Vec<u8>> {
        reference(self.reference())?;
        let operation = match self {
            Self::Read((r,)) => return codec::encode(&maps.read_navigation(&r)?),
            Self::Commit(r, state, change) => {
                return codec::encode(&maps.commit_navigation(&r, &state, change)?)
            }
            Self::Choices(reference, navigation, query) => RegionOperation::Choices {
                reference,
                navigation,
                query,
            },
            Self::Draw(reference, navigation, drawing) => RegionOperation::Draw {
                reference,
                navigation,
                drawing,
            },
        };
        let value = maps
            .navigate(operation, |asset| {
                std::future::ready(files.read(&asset.location))
            })
            .await?;
        codec::encode(&value)
    }
}
