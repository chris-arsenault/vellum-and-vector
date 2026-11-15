//! Resolve private immutable inputs from field records and local resource descriptors.
use crate::{
    generation_frame::Field,
    generation_inputs::{AuthoredField, CapturedField, Patch, Reference},
    numerical_resource::{Descriptor, ResourceLayout, State, Store},
};
use atlas_generation::features::records::State as RecordState;
use atlas_map::Geometry;
use serde::{Deserialize, Serialize};
use std::io;

#[derive(Serialize, Deserialize)]
pub struct Read {
    pub id: String,
    pub names: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldPatch {
    pub area_id: String,
    pub field_id: String,
    pub resource_id: String,
    pub space_id: String,
    pub footprint: Geometry,
    pub channels: Vec<String>,
    #[serde(default)]
    pub input: bool,
    #[serde(default)]
    pub map_only: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Inputs {
    pub reads: Vec<Read>,
    pub patches: Vec<FieldPatch>,
}
pub struct Resolved {
    pub fields: Vec<CapturedField>,
    pub authored: Vec<AuthoredField>,
    pub parent_span: Option<f64>,
}
impl Inputs {
    fn read(&self, id: &str) -> Option<&Read> {
        self.reads.iter().find(|read| read.id == id)
    }
    fn reference(&self, field: &Field, read: &Read) -> io::Result<Reference> {
        let resource_id = field
            .resource_id
            .as_ref()
            .ok_or_else(|| io::Error::other("Generation reads completed numerical resources"))?;
        let overlays = self
            .patches
            .iter()
            .filter(|patch| patch.field_id == field.id && !patch.map_only)
            .filter_map(|patch| {
                let channels: Vec<_> = patch
                    .channels
                    .iter()
                    .filter(|name| read.names.contains(name))
                    .cloned()
                    .collect();
                (!channels.is_empty()).then(|| Patch {
                    footprint: patch.footprint.clone(),
                    channels: channels.clone(),
                    source: Reference {
                        resource_id: patch.resource_id.clone(),
                        channels,
                        overlays: Vec::new(),
                    },
                })
            })
            .collect();
        Ok(Reference {
            resource_id: resource_id.clone(),
            channels: read.names.clone(),
            overlays,
        })
    }
    fn patch_reference(&self, patch: &FieldPatch, fields: &[Field]) -> io::Result<Reference> {
        if let Some(read) = self.read(&patch.field_id) {
            let field = fields
                .iter()
                .find(|field| field.id == patch.field_id)
                .ok_or_else(|| {
                    io::Error::other("Authored fields retain their completed reference")
                })?;
            return self.reference(field, read);
        }
        let read = self.read(&patch.resource_id).ok_or_else(|| {
            io::Error::other("Load the effective sampled field for every authored patch")
        })?;
        Ok(Reference {
            resource_id: patch.resource_id.clone(),
            channels: read.names.clone(),
            overlays: Vec::new(),
        })
    }
    /// Local asynchronous adapters open these immutable handles before synchronous band reads.
    pub fn references(&self, fields: &[Field]) -> io::Result<Vec<Reference>> {
        let mut result = Vec::new();
        for field in fields {
            if let Some(read) = self.read(&field.id) {
                result.push(self.reference(field, read)?);
            }
        }
        for patch in self
            .patches
            .iter()
            .filter(|patch| !patch.input && !patch.map_only)
        {
            result.push(self.patch_reference(patch, fields)?);
        }
        Ok(result)
    }
    pub fn resolve(&self, fields: &[Field], area: &str, store: &dyn Store) -> io::Result<Resolved> {
        let mut result = Resolved {
            fields: Vec::new(),
            authored: Vec::new(),
            parent_span: None,
        };
        for field in fields {
            let read = self.read(&field.id);
            let protected = matches!(
                field.state,
                Some(RecordState::Authored | RecordState::Protected)
            );
            let Some(read) = read else {
                if protected {
                    return Err(io::Error::other(
                        "Load the effective sampled field for every authored field",
                    ));
                }
                continue;
            };
            let source = self.reference(field, read)?;
            let descriptor = describe(store, &source)?;
            let scope = &descriptor.field.as_ref().expect("validated field").scope;
            if field.input
                && field.area_id == area
                && read.names.iter().any(|name| name == "Elevation")
            {
                let span = sample_span(&descriptor)?;
                result.parent_span = Some(result.parent_span.map_or(span, |old| old.max(span)));
            }
            result.fields.push(CapturedField {
                area: field.area_id.clone(),
                space: scope.located.space_id.clone(),
                input: field.input,
                resolution: scope.resolution,
                footprint: scope.footprint.clone(),
                source,
            });
            if protected {
                result.authored.push(AuthoredField {
                    space: field.space_id.clone(),
                    footprint: field
                        .footprint
                        .clone()
                        .unwrap_or_else(|| scope.footprint.clone()),
                    source_footprint: scope.footprint.clone(),
                    channels: field.channels.clone().unwrap_or_else(|| read.names.clone()),
                    source: self.reference(field, read)?,
                });
            }
        }
        for patch in self
            .patches
            .iter()
            .filter(|patch| !patch.input && !patch.map_only)
        {
            let source = self.patch_reference(patch, fields)?;
            let descriptor = describe(store, &source)?;
            result.authored.push(AuthoredField {
                space: Some(patch.space_id.clone()),
                footprint: patch.footprint.clone(),
                source_footprint: descriptor.field.expect("validated field").scope.footprint,
                channels: patch.channels.clone(),
                source,
            });
        }
        Ok(result)
    }
}
fn describe(store: &dyn Store, source: &Reference) -> io::Result<Descriptor> {
    let descriptor = store.describe(&source.resource_id)?;
    if descriptor.id != source.resource_id || descriptor.state != State::Ready {
        return Err(io::Error::other(
            "Load a completed current-format numerical resource",
        ));
    }
    let field = descriptor
        .field
        .as_ref()
        .ok_or_else(|| io::Error::other("Load a completed field resource"))?;
    if source
        .channels
        .iter()
        .any(|name| !field.channels.contains_key(name))
    {
        return Err(io::Error::other(
            "Requested channels must exist in their completed field",
        ));
    }
    Ok(descriptor)
}
fn sample_span(descriptor: &Descriptor) -> io::Result<f64> {
    let [w, s, e, n] = descriptor.bounds;
    if descriptor.layout != ResourceLayout::Regular {
        let count = descriptor
            .arrays
            .iter()
            .find(|array| array.name == "active")
            .ok_or_else(|| io::Error::other("Captured fields retain their active sample shape"))?
            .length()?;
        if count == 0 {
            return Err(io::Error::other("Captured fields need samples"));
        }
        return Ok(((e - w) * (n - s) / count as f64).sqrt());
    }
    if let Some(size) = descriptor
        .sampling
        .filter(|size| size.width > 1 && size.height > 1)
    {
        return Ok(((e - w) / (size.width - 1) as f64).max((n - s) / (size.height - 1) as f64));
    }
    Ok(descriptor
        .field
        .as_ref()
        .and_then(|field| field.scope.resolution)
        .unwrap_or(0.0))
}
