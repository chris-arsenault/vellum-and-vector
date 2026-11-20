//! Map-owned completed resource references, opened on the same host as generation.
use crate::numerical_resource::WorkingSet;
use atlas_generation::{
    atlas::workspace::inputs::Record,
    field::{
        inheritance::resources::{Overlay, Resource},
        protection::Input,
    },
};
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::{io, rc::Rc};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reference {
    pub resource_id: String,
    pub channels: Vec<String>,
    pub overlays: Vec<Patch>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch {
    pub footprint: Geometry,
    pub channels: Vec<String>,
    pub source: Reference,
}
impl Reference {
    pub fn load(&self, resources: &mut WorkingSet) -> io::Result<Rc<Resource>> {
        let mut value = resources.load(&self.resource_id, &self.channels)?;
        for patch in &self.overlays {
            let resource = patch.source.load(resources)?;
            Rc::make_mut(&mut value).overlays.push(Overlay {
                footprint: patch.footprint.clone(),
                channels: patch.channels.clone(),
                resource,
            });
        }
        Ok(value)
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedField {
    pub area: atlas_map::Id,
    pub space: atlas_map::Id,
    pub input: bool,
    pub resolution: Option<f64>,
    pub footprint: Geometry,
    pub source: Reference,
}
impl CapturedField {
    pub fn load(&self, resources: &mut WorkingSet) -> io::Result<Record> {
        Ok(Record {
            area: self.area,
            space: self.space,
            input: self.input,
            resolution: self.resolution,
            footprint: self.footprint.clone(),
            resource: self.source.load(resources)?,
        })
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthoredField {
    pub space: Option<atlas_map::Id>,
    pub footprint: Geometry,
    pub source_footprint: Geometry,
    pub channels: Vec<String>,
    pub source: Reference,
}
impl AuthoredField {
    pub fn load(&self, resources: &mut WorkingSet) -> io::Result<Input> {
        Ok(Input {
            source: self.source.load(resources)?,
            space: self.space,
            footprint: self.footprint.clone(),
            source_footprint: self.source_footprint.clone(),
            channels: self.channels.clone(),
        })
    }
}
