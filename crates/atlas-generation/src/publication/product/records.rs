use super::{
    inputs::{chart_copy, Selected},
    Assets, Product, Target,
};
use crate::{
    control::GenerationControl,
    publication::{
        fields, history,
        illustration::{self, Ocean},
        samples::{Binding, Samples},
    },
    storage::Coverage,
};
use atlas_map::{LayerSource, MapDescriptor, MapFeature, MapLayer, PublicationBatch, Publisher};
use serde::Serialize;
use serde_json::json;
use std::{
    cell::RefCell,
    io::{self, Write},
};

/// Records per append. Each append is one storage transaction, so a city's hundreds of
/// thousands of records are written in batches large enough that commits do not dominate.
const BATCH_SIZE: usize = 1024;
/// The published surface class a real-scale hex reports as its ground.
pub(super) const SURFACE: &str = "finalSurface";
fn write_record(
    writer: &mut impl Write,
    value: &impl Serialize,
    first: &mut bool,
) -> io::Result<()> {
    if !*first {
        writer.write_all(b",")?;
    }
    *first = false;
    serde_json::to_writer(writer, value).map_err(io::Error::other)
}
fn vector_record(feature: &MapFeature) -> serde_json::Value {
    let mut properties = serde_json::to_value(&feature.attributes).expect("JSON attributes");
    properties.as_object_mut().unwrap().extend(json!({
        "name":feature.name, "layerId":feature.layer_id, "entityId":feature.entity_id, "kind":feature.kind,
        "typeId":feature.type_id, "catalog":feature.catalog, "footprint":feature.footprint, "relations":feature.relations, "causes":feature.causes,
    }).as_object().unwrap().clone());
    json!({"type":"Feature", "id":feature.id, "geometry":feature.geometry, "properties":properties})
}
impl Product<'_> {
    pub(super) async fn vectors(
        &self,
        map: &MapDescriptor,
        selected: &Selected<'_>,
        publisher: &mut impl Publisher,
        assets: &mut impl Assets,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let mut marks = map.real_scale.as_ref().map(|_| Vec::new());
        let mut cave_marks = marks.clone();
        let mut hex_layer = None;
        let key = crate::publication::key::map_key(&self.vectors, map)?;
        for layer in &map.layers {
            if layer.id == "vector:hexes" {
                hex_layer = Some(layer);
                continue;
            }
            if layer.id == super::underground::CAVE_HEXES {
                continue;
            }
            let layer_marks = if crate::publication::layers::underground(&layer.id) {
                &mut cave_marks
            } else {
                &mut marks
            };
            let features = self.vectors.presented(
                layer
                    .id
                    .strip_prefix("vector:")
                    .unwrap_or(layer.id.as_str()),
            );
            let features = features.map_err(io::Error::other)?.map(|feature| {
                let mut feature = self
                    .vectors
                    .record(feature.map_err(io::Error::other)?)
                    .map_err(io::Error::other)?;
                if let Some(number) = key.get(&feature.id) {
                    feature
                        .attributes
                        .insert("keyNumber".into(), (*number).into());
                }
                // A feature lives in its layer's located space (the surface or underground).
                feature.space_id.clone_from(&layer.space_id);
                Ok(feature)
            });
            self.vector_layer(
                map,
                layer,
                features,
                layer_marks,
                publisher,
                assets,
                control,
            )
            .await?;
        }
        self.cave_hexes(map, &cave_marks, publisher, assets, control)
            .await?;
        if let (Some(real), Some(layer), Some(sources)) = (&map.real_scale, hex_layer, &marks) {
            let spatial = self.vectors.registry.spatial;
            // The descriptor's bounds stay compact across a cylinder seam.
            let frame = map.bounds;
            let area = self.descriptor.area;
            let groups = selected.groups();
            let surface = groups
                .iter()
                .find(|(resource, _)| resource.channels.contains_key(SURFACE));
            let labels = map
                .layers
                .iter()
                .find(|layer| layer.id == fields::layer_id(SURFACE))
                .and_then(|layer| match &layer.source {
                    LayerSource::Raster(source) => {
                        source.bands.first().map(|band| band.categories.as_slice())
                    }
                    _ => None,
                })
                .unwrap_or(&[]);
            let ground = surface.map(|(resource, _)| super::hexes::Ground {
                resource,
                channel: SURFACE,
                labels,
            });
            let hexes =
                super::hexes::hex_features(real, frame, area, sources, ground.as_ref(), spatial)?
                    .into_iter()
                    .map(|feature| self.vectors.record(feature).map_err(io::Error::other));
            self.vector_layer(map, layer, hexes, &mut None, publisher, assets, control)
                .await?;
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn vector_layer(
        &self,
        map: &MapDescriptor,
        layer: &MapLayer,
        features: impl Iterator<Item = io::Result<MapFeature>>,
        marks: &mut Option<Vec<(atlas_map::Geometry, &'static str)>>,
        publisher: &mut impl Publisher,
        assets: &mut impl Assets,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let LayerSource::Vector(source) = &layer.source else {
            return Ok(());
        };
        let mut writer = assets.create(&source.asset_id, &source.media_type)?;
        writer.write_all(b"{\"type\":\"FeatureCollection\",\"features\":[")?;
        let mut first = true;
        let mut batch = PublicationBatch::default();
        for feature in features {
            let feature = feature?;
            if let Some(marks) = marks {
                marks.extend(super::hexes::mark_shape(&feature));
            }
            write_record(&mut writer, &vector_record(&feature), &mut first)?;
            batch.features.push(feature);
            if batch.features.len() == BATCH_SIZE {
                publisher.append(&map.reference, std::mem::take(&mut batch))?;
                control
                    .cooperate()
                    .await
                    .map_err(|e| io::Error::other(format!("{e:?}")))?;
            }
        }
        if !batch.features.is_empty() {
            publisher.append(&map.reference, batch)?;
        }
        writer.write_all(b"]}")?;
        let asset = assets.close(&source.asset_id, &source.media_type, false, writer)?;
        publisher.append(
            &map.reference,
            PublicationBatch {
                assets: vec![asset],
                ..Default::default()
            },
        )?;
        Ok(())
    }
    pub(super) async fn records(
        &self,
        map: &MapDescriptor,
        selected: &Selected<'_>,
        publisher: &mut impl Publisher,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        self.samples(map, selected, publisher, control).await?;
        self.history_and_entities(map, publisher, control).await
    }
    async fn samples(
        &self,
        map: &MapDescriptor,
        selected: &Selected<'_>,
        publisher: &mut impl Publisher,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        for (ordinal, (resource, footprint)) in selected.groups().into_iter().enumerate() {
            let mut bindings = Vec::new();
            for channel in resource.channels.keys() {
                let raster = map
                    .layers
                    .iter()
                    .find(|layer| layer.id == fields::layer_id(channel));
                let layer = raster
                    .or_else(|| map.layers.iter().find(|layer| layer.id == "inspection"))
                    .ok_or_else(|| {
                        io::Error::other(format!("Missing map inspection layer for {channel}"))
                    })?;
                let band = match &layer.source {
                    LayerSource::Raster(source) => {
                        source.bands.iter().find(|band| band.id == "value")
                    }
                    LayerSource::Attributes(source) => {
                        source.bands.iter().find(|band| band.id == *channel)
                    }
                    _ => None,
                }
                .ok_or_else(|| io::Error::other("Missing inspection band"))?;
                bindings.push(Binding {
                    channel,
                    layer_id: &layer.id,
                    band,
                });
            }
            let samples = Samples {
                resource: &resource,
                footprint: footprint.clone(),
                space: &map.primary_space_id,
                chart: (map.primary_space_id == map.world_id)
                    .then(|| chart_copy(&self.descriptor.chart)),
                ordinal,
                bindings,
            };
            let mut batch = PublicationBatch::default();
            for sample in samples.records(self.vectors.registry.spatial)? {
                batch.samples.push(sample?);
                if batch.samples.len() == BATCH_SIZE {
                    publisher.append(&map.reference, std::mem::take(&mut batch))?;
                    control
                        .cooperate()
                        .await
                        .map_err(|e| io::Error::other(format!("{e:?}")))?;
                }
            }
            if !batch.samples.is_empty() {
                publisher.append(&map.reference, batch)?;
            }
        }
        Ok(())
    }
    async fn history_and_entities(
        &self,
        map: &MapDescriptor,
        publisher: &mut impl Publisher,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let mut batch = PublicationBatch::default();
        for entry in history::records(self.history, &map.reference.revision) {
            batch.history.push(entry?);
            if batch.history.len() == BATCH_SIZE {
                publisher.append(&map.reference, std::mem::take(&mut batch))?;
                control
                    .cooperate()
                    .await
                    .map_err(|e| io::Error::other(format!("{e:?}")))?;
            }
        }
        if !batch.history.is_empty() {
            publisher.append(&map.reference, batch)?;
        }
        self.entities(map, publisher, control).await
    }
    async fn entities(
        &self,
        map: &MapDescriptor,
        publisher: &mut impl Publisher,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let mut batch = PublicationBatch::default();
        for entity in self.fields.entities.values() {
            batch.entities.push(history::entity(entity));
            if batch.entities.len() == BATCH_SIZE {
                publisher.append(&map.reference, std::mem::take(&mut batch))?;
                control
                    .cooperate()
                    .await
                    .map_err(|e| io::Error::other(format!("{e:?}")))?;
            }
        }
        if !batch.entities.is_empty() {
            publisher.append(&map.reference, batch)?;
        }
        Ok(())
    }
    pub(super) async fn illustration(
        &self,
        map: &MapDescriptor,
        selected: &Selected<'_>,
        target: &mut Target<'_, impl Publisher, impl Assets>,
        scratch: &RefCell<Coverage>,
        control: &impl GenerationControl,
    ) -> io::Result<()> {
        let publisher = &mut *target.publisher;
        let assets = &mut *target.assets;
        let spatial = self.vectors.registry.spatial;
        let mut features = Vec::new();
        for layer in self.vectors.registry.catalogue.layers.keys() {
            self.vectors
                .visit(layer, |feature| {
                    if [
                        "sovereignty",
                        "control",
                        "claims",
                        "administration",
                        "ecology",
                    ]
                    .contains(&feature.layer_id.as_str())
                        || ["lake", "ocean"].contains(&feature.kind.as_str())
                    {
                        features.push(feature);
                    }
                    Ok(())
                })
                .map_err(io::Error::other)?;
        }
        let oceans = if let Some(field) = selected.channels.get("Elevation") {
            illustration::drawn_ocean(
                &Ocean {
                    field: &field.resource,
                    water: selected.companion(field, "WaterKindCodes"),
                    footprint: &field.footprint,
                    recorded: field.ocean_recorded.then_some(field.ocean.as_ref()),
                    precision: self.descriptor.precision,
                },
                &mut scratch.borrow_mut(),
                spatial,
            )?
            .into_iter()
            .collect()
        } else {
            features
                .iter()
                .filter(|f| f.kind == "ocean")
                .map(|f| f.geometry.clone())
                .collect()
        };
        let records =
            illustration::records(&features, oceans, spatial).map_err(io::Error::other)?;
        let id = assets.identity()?;
        let mut writer = assets.create(&id, "application/geo+json")?;
        writer.write_all(b"{\"type\":\"FeatureCollection\",\"features\":[")?;
        let mut first = true;
        for (index, record) in records.into_iter().enumerate() {
            write_record(
                &mut writer,
                &json!({"type":"Feature", "geometry":record.geometry, "properties":{"featureId":record.feature_id}}),
                &mut first,
            )?;
            if index.is_multiple_of(BATCH_SIZE) {
                control
                    .cooperate()
                    .await
                    .map_err(|e| io::Error::other(format!("{e:?}")))?;
            }
        }
        writer.write_all(b"]}")?;
        let asset = assets.close(&id, "application/geo+json", true, writer)?;
        publisher.append(
            &map.reference,
            PublicationBatch {
                assets: vec![asset],
                ..Default::default()
            },
        )
    }
}
