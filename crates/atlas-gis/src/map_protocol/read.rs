use crate::{
    map_files::{asset_path, MapFiles},
    map_store::{
        codec, FeatureQuery, InspectionRequest, MapAccess, RegistryRequest, SelectionRequest,
    },
};
use atlas_map::{Id, MapRef};
use serde::{Deserialize, Serialize, Serializer};
use std::io;
#[derive(Deserialize)]
#[serde(tag = "method", content = "args", rename_all = "camelCase")]
pub enum ReadCall {
    Open((MapRef,)),
    Layers((MapRef,)),
    Entities(MapRef, Vec<Id>),
    Registry(MapRef, RegistryRequest),
    Settlement(MapRef, Id),
    Features(MapRef, FeatureQuery),
    Inspect(MapRef, InspectionRequest),
    History(MapRef, Option<Id>),
    SelectRegion(MapRef, SelectionRequest),
    Illustration((MapRef,)),
    Geometries(MapRef, Id, Vec<atlas_map::GeometryQuery>),
    Coverage(MapRef, atlas_map::CoverageRequest),
    Areas(MapRef, Id, Vec<atlas_map::Geometry>),
    Asset(MapRef, String),
    Source(MapRef, String),
    Export(MapRef, String),
    FindAddress(MapRef, String),
    /// A structure map's outside context, read from its parent's published GIS.
    Site((MapRef,)),
    /// What a connection feature may lead to, by the Rust connection rule.
    Connections(MapRef, Id),
}
impl ReadCall {
    pub fn reference(&self) -> &MapRef {
        match self {
            Self::Open((r,))
            | Self::Layers((r,))
            | Self::Illustration((r,))
            | Self::Site((r,))
            | Self::Connections(r, _)
            | Self::Entities(r, _)
            | Self::Registry(r, _)
            | Self::Settlement(r, _)
            | Self::Features(r, _)
            | Self::Inspect(r, _)
            | Self::History(r, _)
            | Self::SelectRegion(r, _)
            | Self::Geometries(r, _, _)
            | Self::Coverage(r, _)
            | Self::Areas(r, _, _)
            | Self::Asset(r, _)
            | Self::Source(r, _)
            | Self::Export(r, _)
            | Self::FindAddress(r, _) => r,
        }
    }
    pub fn execute(self, maps: &dyn MapAccess, files: &MapFiles) -> io::Result<Vec<u8>> {
        reference(self.reference())?;
        match self {
            Self::Open((r,)) => codec::encode(&maps.open(&r)?),
            Self::Layers((r,)) => codec::encode(&maps.open(&r)?.layers),
            Self::Entities(r, ids) => codec::encode(&maps.entities(&r, &ids)?),
            Self::Registry(r, q) => codec::encode(&maps.registry(&r, &q)?),
            Self::Settlement(r, id) => codec::encode(&maps.settlement(&r, id)?),
            Self::Features(r, q) => codec::encode(&maps.features(&r, &q)?),
            Self::Inspect(r, q) => codec::encode(&maps.inspect(&r, &q)?),
            Self::History(r, c) => codec::encode(&maps.history(&r, c, None)?),
            Self::SelectRegion(r, q) => codec::encode(&maps.select_region(&r, &q)?),
            Self::Geometries(r, space, queries) => {
                codec::encode(&super::spatial::query(maps, &r, space, &queries)?)
            }
            Self::Coverage(r, q) => codec::encode(&super::spatial::coverage(maps, &r, q)?),
            Self::Areas(r, space, shapes) => {
                codec::encode(&super::spatial::areas(maps, &r, space, &shapes)?)
            }
            Self::Illustration((r,)) => {
                let assets = maps
                    .illustration_assets(&r)?
                    .into_iter()
                    .map(|a| {
                        Ok(MapAsset {
                            media_type: a.media_type,
                            bytes: files.read(&a.location)?,
                        })
                    })
                    .collect::<io::Result<Vec<_>>>()?;
                codec::encode(&assets)
            }
            Self::Asset(r, id) => {
                let a = maps.asset(&r, &id)?;
                codec::encode(&MapAsset {
                    media_type: a.media_type,
                    bytes: files.read(&a.location)?,
                })
            }
            Self::Source(r, id) => {
                let a = maps.asset(&r, &id)?;
                files.path(&a.location)?;
                codec::encode(
                    &serde_json::json!({"mediaType":a.media_type,"url":asset_path(&r,&id)}),
                )
            }
            Self::FindAddress(r, text) => codec::encode(&super::addresses::find(maps, &r, &text)?),
            Self::Site((r,)) => codec::encode(&super::site::context(maps, &r)?),
            Self::Connections(r, id) => {
                codec::encode(&super::connections::candidates_for(maps, &r, id)?)
            }
            Self::Export(r, format) => {
                let mut bytes = Vec::new();
                maps.export(&r, &format, &mut bytes)?;
                codec::encode(&MapAsset {
                    media_type: "application/geo+json".into(),
                    bytes,
                })
            }
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MapAsset {
    media_type: String,
    #[serde(serialize_with = "binary")]
    bytes: Vec<u8>,
}
fn binary<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_bytes(bytes)
}
pub(super) fn reference(r: &MapRef) -> io::Result<()> {
    if r.map_id == Id::NIL || r.revision == Id::NIL {
        return Err(io::Error::other("Choose a map revision"));
    }
    Ok(())
}
