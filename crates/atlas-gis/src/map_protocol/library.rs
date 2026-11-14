use crate::map_store::{codec, MapAccess, SaveRequest};
use atlas_map::MapRef;
use serde::Deserialize;
use std::io;
#[derive(Deserialize)]
#[serde(tag = "method", content = "args", rename_all = "camelCase")]
pub enum LibraryCall {
    List((Option<String>,)),
    Open((String,)),
    Find((String,)),
    Save((SaveRequest,)),
    Related((MapRef,)),
}
impl LibraryCall {
    pub fn execute(self, maps: &dyn MapAccess, saved_at: String) -> io::Result<Vec<u8>> {
        match self {
            Self::List((cursor,)) => {
                codec::encode(&maps.list_saved(cursor.as_deref().unwrap_or_default())?)
            }
            Self::Open((id,)) => codec::encode(&maps.open_saved(&id)?),
            Self::Find((id,)) => codec::encode(&maps.find_saved(&id)?),
            Self::Save((request,)) => codec::encode(&maps.save(request, saved_at)?),
            Self::Related((r,)) => codec::encode(&maps.related(&r)?),
        }
    }
}
