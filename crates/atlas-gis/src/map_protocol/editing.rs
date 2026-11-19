use super::read::reference;
use crate::{
    authoring::{EditStore, TownNames},
    map_files::MapFiles,
    map_store::codec,
};
use atlas_map::{authoring::EditCommand, MapRef};
use serde::Deserialize;
use std::io;

/// Authoring calls on a real-scale map, shared by the browser worker and the LAN service.
#[derive(Deserialize)]
#[serde(tag = "method", content = "args", rename_all = "camelCase")]
pub enum EditingCall {
    Edit(MapRef, EditCommand),
    Undo((MapRef,)),
    Redo((MapRef,)),
    History((MapRef,)),
}
impl EditingCall {
    pub fn reference(&self) -> &MapRef {
        match self {
            Self::Edit(r, _) | Self::Undo((r,)) | Self::Redo((r,)) | Self::History((r,)) => r,
        }
    }
    /// Run the call; new streets and buildings the creator left unnamed are named by `names`.
    pub fn execute(
        self,
        store: &dyn EditStore,
        files: &MapFiles,
        names: &dyn TownNames,
    ) -> io::Result<Vec<u8>> {
        reference(self.reference())?;
        match self {
            Self::Edit(r, command) => codec::encode(&store.edit_named(&r, &command, files, names)?),
            Self::Undo((r,)) => codec::encode(&store.undo(&r)?),
            Self::Redo((r,)) => codec::encode(&store.redo(&r)?),
            Self::History((r,)) => codec::encode(&store.edit_history(&r)?),
        }
    }
}
