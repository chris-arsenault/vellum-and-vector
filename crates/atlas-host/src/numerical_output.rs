//! Current field resource publication. Typed chunks are encoded here on both execution hosts.
mod layout;
mod partitions;
mod summary;
mod vectors;
use crate::{
    numerical_input::{Alias, Array},
    numerical_resource::{
        Descriptor, Field, FieldScope, MaterialCargo, ResourceLayout, Sampling, State,
    },
};
use atlas_generation::{
    control::{ControlError, GenerationControl},
    field::projection::Surface,
    reconstruction::Layout,
};
pub use partitions::{Partition, Slice};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, future::Future, io};
use vectors::Vector;

#[derive(Clone, Serialize)]
pub struct Definition {
    #[serde(flatten)]
    pub descriptor: Descriptor,
    pub partitions: Vec<Partition>,
}
pub struct Resource {
    pub definition: Definition,
    vectors: Vec<Vector>,
    summaries: Option<Value>,
}
pub struct Resources {
    pub layout: Resource,
    pub tree: Option<Resource>,
}
/// The host writes local resource bytes and publishes a ready descriptor only after completion.
pub trait Sink {
    fn committed(&self, id: &str) -> io::Result<Option<Value>>;
    fn create(&mut self, id: &str) -> impl Future<Output = io::Result<()>>;
    fn write(&mut self, id: &str, path: &str, bytes: &[u8])
        -> impl Future<Output = io::Result<()>>;
    fn remove(&mut self, id: &str) -> impl Future<Output = io::Result<()>>;
}
pub struct Frame {
    pub field_id: String,
    pub scope: FieldScope,
    pub precision: f64,
}
fn base(surface: &Surface, id: &str, frame: &Frame) -> Definition {
    let grid = surface.grid();
    let sampling = match grid.layout {
        Layout::Raster { width, height } => Some(Sampling { width, height }),
        Layout::Adaptive(_) => None,
    };
    Definition {
        descriptor: Descriptor {
            schema_version: 1,
            id: id.into(),
            revision: 1,
            scope: frame.scope.located.clone(),
            crs_id: frame.scope.crs_id.clone(),
            bounds: grid.bounds,
            precision: frame.precision,
            layout: if sampling.is_some() {
                ResourceLayout::Regular
            } else {
                ResourceLayout::Adaptive
            },
            sampling,
            periodic_width: grid.periodic_width,
            field: None,
            state: State::Working,
            arrays: Vec::new(),
        },
        partitions: Vec::new(),
    }
}
impl Resources {
    pub fn new(surface: &Surface, id: &str, frame: &Frame) -> io::Result<Self> {
        if !frame.precision.is_finite() || frame.precision <= 0.0 {
            return Err(io::Error::other(
                "Field precision is a positive metre distance",
            ));
        }
        let layout = layout::layout(surface, base(surface, id, frame))?;
        let tree = match &surface.grid().layout {
            Layout::Raster { .. } => None,
            Layout::Adaptive(topology) => Some(layout::tree(
                surface,
                topology,
                base(surface, &format!("{id}:tree"), frame),
            )?),
        };
        Ok(Self { layout, tree })
    }
    pub fn channels(
        &self,
        surface: &Surface,
        id: &str,
        frame: &Frame,
        names: &[String],
    ) -> io::Result<Resource> {
        let mut definition = base(surface, id, frame);
        let layout = &self.layout.definition;
        definition.descriptor.arrays = layout
            .descriptor
            .arrays
            .iter()
            .map(|array| Array {
                source: Some(Alias {
                    resource_id: layout.descriptor.id.clone(),
                    array: array.name.clone(),
                }),
                ..array.clone()
            })
            .collect();
        definition.partitions.clone_from(&layout.partitions);
        let mut field = Field {
            id: frame.field_id.clone(),
            scope: frame.scope.clone(),
            layout_resource_id: layout.descriptor.id.clone(),
            tree_resource_id: self
                .tree
                .as_ref()
                .map(|r| r.definition.descriptor.id.clone()),
            geography_id: layout.descriptor.id.clone(),
            channels: BTreeMap::new(),
            material_cargo: None,
        };
        let mut vectors = Vec::new();
        for (index, name) in names.iter().enumerate() {
            let vector = vectors::channel(surface, name, index)?;
            field
                .channels
                .insert(name.clone(), vector.array.name.clone());
            for partition in &mut definition.partitions {
                if let Some(slice) = partition.array_slices.get("active").cloned() {
                    partition
                        .array_slices
                        .insert(vector.array.name.clone(), slice);
                }
            }
            definition.descriptor.arrays.push(vector.array.clone());
            vectors.push(vector);
        }
        let summaries = summary::summaries(surface, &definition, &field, &vectors)?;
        if let Some(cargo) = surface
            .cargo()
            .filter(|_| names.iter().any(|name| name == "RockLayerKind0"))
        {
            field.material_cargo = Some(MaterialCargo {
                keys: cargo.keys.clone(),
                released_to: cargo.released_to.clone(),
                slots: cargo.slots.clone(),
                offsets: "material_offsets".into(),
                records: "material_records".into(),
            });
            for (name, values) in [
                ("material_offsets", cargo.offsets().into()),
                ("material_records", cargo.records().into()),
            ] {
                let vector = Vector::linear(name, values, vectors::Group::Cells, 1);
                partitions::cargo(surface.grid().bounds, &mut definition.partitions, &vector);
                definition.descriptor.arrays.push(vector.array.clone());
                vectors.push(vector);
            }
        }
        definition.descriptor.field = Some(field);
        Ok(Resource {
            definition,
            vectors,
            summaries: Some(summaries),
        })
    }
}
impl Resource {
    pub fn descriptor(&self, ready: bool) -> io::Result<Value> {
        let mut value = serde_json::to_value(&self.definition)?;
        value["state"] = if ready { "ready" } else { "working" }.into();
        if let Some(Value::Object(summaries)) = &self.summaries {
            value["field"]
                .as_object_mut()
                .ok_or_else(|| io::Error::other("Field summaries require a field"))?
                .extend(summaries.clone());
        }
        crate::numerical_resource::FORMAT.write(&value)
    }
    pub async fn write(
        &self,
        sink: &mut impl Sink,
        control: &impl GenerationControl,
    ) -> io::Result<Value> {
        let id = &self.definition.descriptor.id;
        control.check().map_err(control_error)?;
        if let Some(existing) = sink.committed(id)? {
            let descriptor: Descriptor =
                crate::numerical_resource::FORMAT.read(existing.clone())?;
            if descriptor.scope != self.definition.descriptor.scope
                || descriptor.bounds != self.definition.descriptor.bounds
            {
                return Err(io::Error::other(
                    "Existing output resource belongs to a different scope",
                ));
            }
            return Ok(existing);
        }
        sink.create(id).await?;
        let result = self.write_created(sink, control).await;
        if result.is_err() {
            sink.remove(id).await?;
        }
        result
    }
    async fn write_created(
        &self,
        sink: &mut impl Sink,
        control: &impl GenerationControl,
    ) -> io::Result<Value> {
        let id = &self.definition.descriptor.id;
        sink.write(
            id,
            "resource.json",
            &serde_json::to_vec(&self.descriptor(false)?)?,
        )
        .await?;
        sink.write(
            id,
            "zarr.json",
            br#"{"zarr_format":3,"node_type":"group","attributes":{}}"#,
        )
        .await?;
        for vector in &self.vectors {
            sink.write(
                id,
                &format!("{}/zarr.json", vector.array.name),
                &serde_json::to_vec(&vector.metadata())?,
            )
            .await?;
            for coordinates in vector.chunks() {
                control.cooperate().await.map_err(control_error)?;
                let path = format!(
                    "{}/c/{}",
                    vector.array.name,
                    coordinates
                        .iter()
                        .map(usize::to_string)
                        .collect::<Vec<_>>()
                        .join("/")
                );
                sink.write(id, &path, &vector.chunk(&coordinates)?).await?;
            }
        }
        let ready = self.descriptor(true)?;
        sink.write(id, "resource.json", &serde_json::to_vec(&ready)?)
            .await?;
        Ok(ready)
    }
}
fn control_error(error: ControlError) -> io::Error {
    io::Error::other(format!("{error:?}"))
}
