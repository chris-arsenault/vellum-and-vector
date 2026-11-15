//! A private completed document and creator choices enter the shared application together.
use crate::{
    generation_capture::{Inputs, Read},
    generation_document::Document,
    generation_frame::Geography,
    generation_request::{Capture, Request},
};
use atlas_generation::{
    atlas::configuration::{Input, Settings},
    naming::Configuration,
    spatial::SpatialKernel,
};
use serde::Deserialize;
use serde_json::json;
use std::io;

#[derive(serde::Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Submission {
    pub source: Document,
    pub input: Input,
}
impl Submission {
    pub fn request(&self, spatial: &dyn SpatialKernel) -> io::Result<Request> {
        let world = &self.source.world;
        let geography: Geography = serde_json::from_value(world.clone())?;
        let area = &geography
            .areas
            .get(&self.input.area_id)
            .ok_or_else(|| io::Error::other("Choose an existing mapped area"))?
            .area;
        let reads: Vec<_> = geography
            .fields
            .iter()
            .filter(|field| {
                field.resource_id.is_some()
                    && (area.map.is_none() || (field.area_id == area.id && field.input))
            })
            .map(|field| Read {
                id: field.id.clone(),
                names: field.channels.clone().unwrap_or_default(),
            })
            .collect();
        if area.map.is_some()
            && !reads
                .iter()
                .any(|read| read.names.iter().any(|name| name == "Elevation"))
        {
            return Err(io::Error::other(
                "regional_parent: Capture parent terrain before refining this map",
            ));
        }
        let history: Settings = serde_json::from_value(json!({
            "epochs": world["epochs"], "humanEras": world["humanEras"],
            "magicSystems": world["magicSystems"], "confluences": world["confluences"],
        }))?;
        let drainage = world
            .get("drainage")
            .and_then(|value| value.get(&area.id))
            .cloned()
            .unwrap_or_default();
        Ok(Request {
            naming: Configuration {
                seed: world["seed"]
                    .as_i64()
                    .ok_or_else(|| io::Error::other("World seed is an integer"))?
                    .to_string(),
                domain: spatial
                    .bounds(&geography.reference.domain)
                    .map_err(io::Error::other)?,
            },
            existing: geography
                .generations
                .iter()
                .any(|run| run.area_id.as_ref() == Some(&area.id)),
            landmarks: serde_json::from_value(world["landmarks"].clone())?,
            magic_sources: serde_json::from_value(world["magic"].clone())?,
            entities: serde_json::from_value(world["entities"].clone())?,
            geography,
            input: self.input.clone(),
            history,
            capture: Capture {
                inputs: Inputs {
                    reads,
                    patches: serde_json::from_value(json!(self.source.field_patches))?,
                },
                fields: Vec::new(),
                authored: Vec::new(),
                ancestors: Vec::new(),
                owned_geography: false,
                reopened: false,
                surface_span: None,
                retained_rivers: serde_json::from_value(if drainage["input"] == true {
                    serde_json::Value::Null
                } else {
                    drainage.get("kept").cloned().unwrap_or_default()
                })?,
                drainage: serde_json::from_value(drainage)?,
            },
            region: None,
            crossed_features: Default::default(),
            area_spaces: Default::default(),
        })
    }
}
