use super::{
    inputs::{self, Field, Selected},
    raster_group, Assets, Product, Target,
};
use crate::{
    control::GenerationControl,
    publication::{
        descriptor, fields, geotiff, layers,
        sampling::{self, Lake, Source},
        upload::RasterPublication,
    },
    spatial::Overlay,
    storage::Coverage,
};
use atlas_map::{LayerSource, MapDescriptor, MapLayer, MapSpace, Publisher, VectorSource};
// hpc-exempt: map-layer metadata and named lake geometries, not numerical field storage.
use std::{cell::RefCell, collections::BTreeMap, io};

/// Whether the viewer draws a channel. Applied magic and cell indices are published for
/// inspection only, as attribute layers over the same rasters.
fn drawn(channel: &str, field: &Field) -> bool {
    !(channel.starts_with("magicApplied:") || field.resource.channels[channel].unit == "cell-index")
}
struct RasterPreparation<'a> {
    scratch: &'a RefCell<Coverage>,
    grids: Vec<(String, sampling::Prepared)>,
}

impl Product<'_> {
    pub(super) fn prepare(
        &self,
        selected: &Selected<'_>,
        assets: &mut impl Assets,
    ) -> io::Result<MapDescriptor> {
        let spatial = self.vectors.registry.spatial;
        let mut map = self.descriptor.build(spatial).map_err(io::Error::other)?;
        let profile = self
            .descriptor
            .context
            .area(self.descriptor.area)
            .map_err(io::Error::other)?
            .profile;
        let underground = self.underground(&map)?;
        // A ground map without caves keeps the underground layers a creator draws into as
        // latent ones: drawing the first cave wall opens the space they belong to (ADR 0016).
        let latent_space = descriptor::underground_space(&map).filter(|_| map.real_scale.is_some());
        let mut latent = Vec::new();
        for layer in self
            .vectors
            .registry
            .catalogue
            .layers
            .values()
            .filter(|l| l.profiles.contains(&profile) && l.vector())
        {
            let drawn = atlas_map::authoring::shape_of(&layer.id).is_some();
            let (space_id, is_latent) = match (layers::underground(&layer.id), &underground) {
                (false, _) => (map.primary_space_id, false),
                (true, Some(space)) => (space.id, false),
                (true, None) => match &latent_space {
                    Some(space) if drawn => (space.id, true),
                    _ => continue,
                },
            };
            let published = MapLayer {
                id: format!("vector:{}", layer.id),
                name: layer.name.clone(),
                space_id,
                bounds: map.bounds,
                attribution: Vec::new(),
                catalog: self
                    .vectors
                    .catalogue(&layer.id)
                    .map_err(io::Error::other)?,
                source: LayerSource::Vector(VectorSource {
                    asset_id: assets.identity()?,
                    media_type: "application/geo+json".into(),
                }),
            };
            if is_latent {
                latent.push(published);
            } else {
                map.layers.push(published);
            }
        }
        map.spaces.extend(underground);
        self.authoring_choices(&mut map, selected, latent);
        Ok(map)
    }
    /// A real-scale map with caves publishes its underground space; a map without caves
    /// publishes no underground layers.
    fn underground(&self, map: &MapDescriptor) -> io::Result<Option<MapSpace>> {
        if map.real_scale.is_none() {
            return Ok(None);
        }
        let mut caves = self.vectors.presented("caves").map_err(io::Error::other)?;
        if caves
            .next()
            .transpose()
            .map_err(io::Error::other)?
            .is_none()
        {
            return Ok(None);
        }
        Ok(descriptor::underground_space(map))
    }
    pub(super) async fn rasters(
        &self,
        map: &mut MapDescriptor,
        selected: &Selected<'_>,
        target: &mut Target<'_, impl Publisher, impl Assets>,
        scratch: &RefCell<Coverage>,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        if let Some(parent) = self.parent_rasters {
            return self.cropped_rasters(map, parent, target, control).await;
        }
        let mut preparation = RasterPreparation {
            scratch,
            grids: Vec::new(),
        };
        for group in self.raster_groups(selected) {
            self.raster_asset(map, (selected, &group), target, &mut preparation, control)
                .await?;
        }
        Ok(())
    }
    fn raster_groups<'a>(&self, selected: &Selected<'a>) -> Vec<Vec<(String, &'a Field)>> {
        let mut groups: Vec<Vec<(String, &'a Field)>> = Vec::new();
        for (channel, field) in &selected.channels {
            let path = self.fields.catalog(channel).path;
            let shown = drawn(channel, field);
            let index = groups.iter().position(|group| {
                let (first, source) = &group[0];
                channel != "Elevation"
                    && first != "Elevation"
                    && source.id == field.id
                    && drawn(first, source) == shown
                    && self.fields.catalog(first).path == path
            });
            if let Some(index) = index {
                groups[index].push((channel.clone(), field));
            } else {
                groups.push(vec![(channel.clone(), field)]);
            }
        }
        groups
    }
    async fn raster_asset(
        &self,
        map: &mut MapDescriptor,
        inputs: (&Selected<'_>, &[(String, &Field)]),
        target: &mut Target<'_, impl Publisher, impl Assets>,
        preparation: &mut RasterPreparation<'_>,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let (selected, group) = inputs;
        let scratch = preparation.scratch;
        let spatial = self.vectors.registry.spatial;
        let field = group[0].1;
        let Some(footprint) = inputs::footprint(
            self.descriptor.context,
            self.descriptor.area,
            field,
            spatial,
        )?
        else {
            return Ok(());
        };
        let lakes = if group[0].0 == "Elevation" {
            self.lakes(field)?
        } else {
            Vec::new()
        };
        let colors = self.fields.categories("finalSurface");
        let bounds = self
            .descriptor
            .chart
            .compact_bounds(&footprint, spatial)
            .map_err(io::Error::other)?;
        let id = target.assets.identity()?;
        let mut storage = target.assets.scratch()?;
        let mut raster = None;
        let mut owners = Vec::new();
        let mut layers = Vec::new();
        for (index, (channel, _)) in group.iter().enumerate() {
            control
                .progress(&crate::control::GenerationProgress {
                    path: vec!["map-publication".into()],
                    fraction: index as f64 / group.len() as f64,
                    message: format!("Publishing map layer: {}", self.fields.label(channel)),
                })
                .map_err(|error| io::Error::other(format!("{error:?}")))?;
            let source = Source {
                field: &field.resource,
                channel,
                footprint: &footprint,
                bounds,
                wrap: self.descriptor.chart.cylindrical.then_some([
                    self.descriptor.chart.bounds.0,
                    self.descriptor.chart.bounds.2,
                ]),
                water: selected.companion(field, "WaterKindCodes"),
                ice: selected.companion(field, "IceThickness"),
                surface: selected.companion(field, "finalSurface"),
                colors: &colors,
                ocean: field.ocean.as_ref(),
                lakes: &lakes,
            };
            let input = fields::input(&self.fields, &source, id.clone(), spatial)?;
            let grid = input.grid;
            let slot = match preparation
                .grids
                .iter()
                .position(|(id, held)| id == &field.id && held.grid == grid)
            {
                Some(slot) => slot,
                None => {
                    let prepared =
                        sampling::Prepared::new(&source, grid, scratch, spatial, control).await?;
                    preparation.grids.push((field.id.clone(), prepared));
                    preparation.grids.len() - 1
                }
            };
            let mut publication = RasterPublication::new(input, target.assets.scratch()?)?;
            sampling::publish(
                &source,
                &preparation.grids[slot].1,
                &mut publication,
                scratch,
                spatial,
                control,
            )
            .await?;
            let (source, owner) =
                raster_group::append(&mut raster, channel, publication, &mut storage)?;
            owners.push(owner);
            layers.push(MapLayer {
                id: fields::layer_id(channel),
                name: self.fields.label(channel),
                space_id: self
                    .descriptor
                    .context
                    .space(field.area)
                    .map_err(io::Error::other)?,
                bounds: grid.bounds,
                attribution: Vec::new(),
                catalog: self.fields.catalog(channel),
                source: if drawn(channel, field) {
                    LayerSource::Raster(source)
                } else {
                    LayerSource::Attributes(source)
                },
            });
        }
        let mut writer = target.assets.create(&id, "image/tiff")?;
        geotiff::write(
            &mut writer,
            raster.as_ref().expect("Nonempty GIS group"),
            &mut storage,
            control,
        )
        .await?;
        let asset = target.assets.close(&id, "image/tiff", false, writer)?;
        target
            .publisher
            .add_layers(&map.reference, &layers, asset)?;
        map.layers.extend(layers);
        Ok(())
    }
    fn lakes(&self, field: &Field) -> io::Result<Vec<Lake>> {
        let spatial = self.vectors.registry.spatial;
        // hpc-exempt: map-layer metadata and named lake geometries, not numerical field storage.
        let mut lakes = BTreeMap::new();
        self.vectors
            .visit("lakes", |feature| {
                if feature.kind == "lake" {
                    if let Some(level) = feature
                        .attributes
                        .get("waterLevel")
                        .and_then(serde_json::Value::as_f64)
                    {
                        lakes.insert(
                            feature.id,
                            Lake {
                                geometry: feature.geometry,
                                level,
                            },
                        );
                    }
                }
                Ok(())
            })
            .map_err(io::Error::other)?;
        for lake in &field.lakes {
            let geometry = match lakes.remove(&lake.id) {
                Some(previous) => spatial
                    .overlay(&previous.geometry, &lake.geometry, Overlay::Union)
                    .map_err(io::Error::other)?
                    .ok_or_else(|| io::Error::other("Lake union is empty"))?,
                None => lake.geometry.clone(),
            };
            lakes.insert(
                lake.id,
                Lake {
                    geometry,
                    level: lake.level,
                },
            );
        }
        Ok(lakes.into_values().collect())
    }
}
