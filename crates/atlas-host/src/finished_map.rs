//! Publish ordinary GIS products from private completed inputs. No reader receives these capabilities.
use crate::{
    generation_capture::FieldPatch,
    generation_frame::Geography,
    generation_inputs::{Patch, Reference},
    numerical_resource::{Scope, Store, WorkingSet},
};
use atlas_generation::{
    atlas::history::EpochHistory,
    control::GenerationControl,
    features::{chart::Chart, context::Context, records::Entity, Feature, FeatureReader},
    field::landmarks::catalogue::Landmark,
    magic::{configuration::System, confluences::configuration::Confluence},
    publication::{
        catalogue::Catalogue,
        crop::ParentRasters,
        descriptor::Descriptor,
        fields::Fields,
        placed::{self, MagicSource},
        product::{
            inputs::{self, Field, Lake},
            Assets, Product,
        },
        registry::Registry,
        vectors::Vectors,
    },
    spatial::SpatialKernel,
    storage::SharedCache,
};
use atlas_map::{Geometry, Id, MapRef, Publisher};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, collections::BTreeMap, io, rc::Rc};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    #[serde(flatten)]
    pub geography: Geography,
    pub entities: BTreeMap<Id, Entity>,
    pub magic_systems: Vec<System>,
    pub confluences: Vec<Confluence>,
    pub magic: Vec<MagicSource>,
    pub landmarks: Vec<Landmark>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub world: World,
    pub area_id: Id,
    pub reference: MapRef,
    pub expected: Option<MapRef>,
    pub parent: Option<MapRef>,
    pub progressive: bool,
    pub field_patches: Vec<FieldPatch>,
    pub history: Vec<EpochHistory>,
}
/// Initial generation installs streamed output; regenerating generated geography is atomic.
/// A child whose only revision is its capture has not been generated, so its first completed
/// run streams too, replacing the capture revision.
pub fn progressive(world: &serde_json::Value, area: Id, expected: Option<&MapRef>) -> bool {
    let area = area.to_string();
    expected.is_none()
        || world["generations"].as_array().map_or(0, |runs| {
            runs.iter()
                .filter(|run| run["areaId"] == area.as_str())
                .count()
        }) <= 1
}
#[derive(Clone, Serialize, Deserialize)]
pub struct WaterBody {
    pub id: Id,
    pub geometry: Geometry,
    pub level: f64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct FieldGeography {
    pub id: String,
    pub scope: Scope,
    #[serde(
        default,
        deserialize_with = "recorded_ocean",
        skip_serializing_if = "Option::is_none"
    )]
    pub ocean: Option<Option<Geometry>>,
    #[serde(default)]
    pub lakes: Vec<WaterBody>,
}
fn recorded_ocean<'de, D: serde::Deserializer<'de>>(
    input: D,
) -> Result<Option<Option<Geometry>>, D::Error> {
    Option::<Geometry>::deserialize(input).map(Some)
}
pub struct PreparedMap {
    request: Request,
    context: Context,
    numerical: Vec<Field>,
    placed: Vec<Feature>,
    parent_rasters: Option<ParentRasters>,
}
impl Request {
    pub fn from_document(
        mut document: crate::generation_document::Document,
        reference: MapRef,
        expected: Option<MapRef>,
        parent: Option<MapRef>,
    ) -> io::Result<Self> {
        Ok(Self {
            progressive: progressive(&document.world, reference.map_id, expected.as_ref()),
            world: serde_json::from_value(document.world)?,
            area_id: reference.map_id,
            reference,
            expected,
            parent,
            field_patches: document
                .field_patches
                .into_iter()
                .map(serde_json::from_value)
                .collect::<Result<_, _>>()?,
            history: serde_json::from_value(
                document
                    .metadata
                    .remove("history")
                    .unwrap_or_else(|| serde_json::json!([])),
            )?,
        })
    }
    pub fn references(&self) -> io::Result<Vec<(String, Reference)>> {
        let context = self.world.geography.context();
        let space = context.space(self.area_id).map_err(io::Error::other)?;
        let areas = context
            .geography_areas(self.area_id)
            .map_err(io::Error::other)?;
        let mut selected = Vec::new();
        for field in &self.world.geography.fields {
            if !areas.contains(&field.area_id)
                || context.space(field.area_id).map_err(io::Error::other)? != space
            {
                continue;
            }
            let Some(names) = field.channels.as_ref().filter(|names| !names.is_empty()) else {
                continue;
            };
            let resource_id = field.resource_id.as_ref().ok_or_else(|| {
                io::Error::other("Map publication reads completed field resources")
            })?;
            let mut overlays = Vec::new();
            for patch in self
                .field_patches
                .iter()
                .filter(|patch| patch.field_id == field.id)
            {
                if patch.map_only
                    && !context
                        .descendant(self.area_id, patch.area_id)
                        .map_err(io::Error::other)?
                {
                    continue;
                }
                let channels: Vec<_> = patch
                    .channels
                    .iter()
                    .filter(|name| names.contains(name))
                    .cloned()
                    .collect();
                if channels.is_empty() {
                    continue;
                }
                overlays.push(Patch {
                    footprint: patch.footprint.clone(),
                    channels: channels.clone(),
                    source: Reference {
                        resource_id: patch.resource_id.clone(),
                        channels,
                        overlays: Vec::new(),
                    },
                });
            }
            selected.push((
                field.id.clone(),
                Reference {
                    resource_id: resource_id.clone(),
                    channels: names.clone(),
                    overlays,
                },
            ));
        }
        Ok(selected)
    }
    pub fn prepare(
        self,
        store: Rc<dyn Store>,
        cache: SharedCache,
        geography: &[FieldGeography],
        records: &dyn FeatureReader,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<PreparedMap> {
        let context = self.world.geography.context();
        let outline = inputs::outline(&context, self.area_id)?;
        let mut resources = WorkingSet::new(store.clone(), cache);
        let mut numerical = Vec::new();
        for (id, source) in self.references()? {
            let field = self
                .world
                .geography
                .fields
                .iter()
                .find(|field| field.id == id)
                .expect("selected field");
            let descriptor = store.describe(&source.resource_id)?;
            let manifest = descriptor
                .field
                .as_ref()
                .ok_or_else(|| io::Error::other("Map publication requires field manifests"))?;
            let shape = geography
                .iter()
                .find(|shape| shape.id == manifest.geography_id && shape.scope == descriptor.scope)
                .ok_or_else(|| {
                    io::Error::other("Map publication requires the field's pinned geography")
                })?;
            let footprint = field
                .footprint
                .clone()
                .unwrap_or_else(|| manifest.scope.footprint.clone());
            // A field lying only in the context band has nothing to publish on this map.
            let Some(footprint) = inputs::within(footprint, outline, spatial)? else {
                continue;
            };
            numerical.push(Field {
                id,
                area: field.area_id,
                input: field.input,
                footprint,
                resource: source.load(&mut resources)?,
                ocean: shape.ocean.clone().flatten(),
                ocean_recorded: shape.ocean.is_some(),
                lakes: shape
                    .lakes
                    .iter()
                    .map(|lake| Lake {
                        id: lake.id,
                        geometry: lake.geometry.clone(),
                        level: lake.level,
                    })
                    .collect(),
            });
        }
        let mut placed =
            placed::records(&context, &self.world.magic, &self.world.landmarks, spatial)
                .map_err(io::Error::other)?;
        for value in &mut placed {
            if value.kind != "landmark" {
                continue;
            }
            if let Some(mut realized) = records
                .get(value.id)?
                .filter(|feature| feature.kind == "landmark")
            {
                if !value.name.is_empty() {
                    realized.name.clone_from(&value.name);
                }
                for name in ["landmarkKind", "emplacedAtEpoch"] {
                    if let Some(attribute) = value.attributes.get(name) {
                        realized.attributes.insert(name.into(), attribute.clone());
                    }
                }
                *value = realized;
            }
        }
        Ok(PreparedMap {
            request: self,
            context,
            numerical,
            placed,
            parent_rasters: None,
        })
    }
}
impl PreparedMap {
    pub async fn publish(
        &self,
        records: &dyn FeatureReader,
        spatial: &dyn SpatialKernel,
        publisher: &mut impl Publisher,
        assets: &mut impl Assets,
        control: &impl GenerationControl,
    ) -> io::Result<MapRef> {
        let scratch = RefCell::new(assets.scratch()?);
        let world = &self.request.world;
        let reference = &world.geography.reference;
        let product = Product {
            descriptor: Descriptor {
                context: &self.context,
                chart: Chart {
                    domain: &reference.domain,
                    bounds: spatial
                        .bounds(&reference.domain)
                        .map_err(io::Error::other)?,
                    cylindrical: reference.boundary_mode.as_deref() == Some("cylinder"),
                },
                area: self.request.area_id,
                reference: self.request.reference.clone(),
                parent: self.request.parent.clone(),
                precision: reference.precision.unwrap_or(1e-6),
            },
            expected: self.request.expected.as_ref(),
            progressive: self.request.progressive,
            vectors: Vectors {
                registry: Registry {
                    context: &self.context,
                    catalogue: Catalogue {
                        layers: &world.geography.layers,
                        systems: &world.magic_systems,
                        confluences: &world.confluences,
                    },
                    entities: &world.entities,
                    reader: records,
                    spatial,
                },
                area: self.request.area_id,
                placed: &self.placed,
            },
            fields: Fields {
                entities: &world.entities,
                systems: &world.magic_systems,
                confluences: &world.confluences,
            },
            numerical: &self.numerical,
            history: &self.request.history,
            parent_rasters: self.parent_rasters.as_ref(),
        };
        product.publish(publisher, assets, &scratch, control).await
    }
    /// A captured child shows its parent's published rasters, cropped rather than resampled.
    pub fn with_parent_rasters(mut self, rasters: ParentRasters) -> Self {
        self.parent_rasters = Some(rasters);
        self
    }
}
/// The parent's published raster layers and their asset files, for a captured child's map.
pub fn parent_rasters(
    maps: &dyn atlas_gis::map_store::MapAccess,
    files: &atlas_gis::map_files::MapFiles,
    parent: &MapRef,
) -> io::Result<ParentRasters> {
    let descriptor = maps.open(parent)?;
    let mut locations = std::collections::BTreeMap::new();
    let mut layers = Vec::new();
    for layer in descriptor.layers {
        if let atlas_map::LayerSource::Raster(source) | atlas_map::LayerSource::Attributes(source) =
            &layer.source
        {
            let asset = maps.asset(parent, &source.asset_id)?;
            locations.insert(source.asset_id.clone(), files.path(&asset.location)?);
            layers.push(layer);
        }
    }
    Ok(ParentRasters {
        layers,
        open: Box::new(move |id: &str| {
            let path = locations
                .get(id)
                .ok_or_else(|| io::Error::other("The parent map has no such raster"))?;
            Ok(
                Box::new(std::io::BufReader::new(std::fs::File::open(path)?))
                    as Box<dyn atlas_generation::publication::crop::ReadSeek>,
            )
        }),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_new_and_first_generated_maps_stream() {
        let id = atlas_map::Id::from_name;
        let captured = MapRef {
            map_id: id("child"),
            revision: id("captured"),
        };
        let world = |runs: &[&str]| {
            serde_json::json!({"generations": runs.iter()
                .map(|area| serde_json::json!({"areaId": id(area)})).collect::<Vec<_>>()})
        };
        assert!(progressive(&world(&["world"]), id("child"), None));
        assert!(progressive(
            &world(&["world", "child"]),
            id("child"),
            Some(&captured)
        ));
        assert!(!progressive(
            &world(&["world", "child", "child"]),
            id("child"),
            Some(&captured)
        ));
        assert!(!progressive(
            &world(&["world", "world"]),
            id("world"),
            Some(&captured)
        ));
    }
}
