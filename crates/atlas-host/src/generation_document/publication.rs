use super::{union, Preparation, Records};
use crate::{
    generation_output::Completed,
    numerical_resource::{Descriptor, FieldScope},
};
use atlas_generation::{
    features::{
        network::{NetworkReader, Selection},
        Feature, FeatureSelection, State,
    },
    identity::semantic_id,
    publication::geographies::Binding,
    spatial::{Overlay, Predicate, SpatialKernel},
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, io};

impl Preparation {
    pub(super) fn publish(
        &mut self,
        output: &Completed,
        operation: &str,
        records: &Records<'_>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        let mut layers = BTreeSet::new();
        for item in records.features.values(FeatureSelection::default())? {
            let feature = item?;
            if feature.area_id != self.document.scope.located.area_id
                || feature.state != State::Generated
            {
                continue;
            }
            let binding = self
                .geography
                .iter()
                .find(|b| b.layer == feature.layer_id && b.kinds.contains(&feature.kind));
            let before = records.original.get(feature.id)?;
            if before.as_ref() != Some(&feature) {
                let binding = binding.ok_or_else(|| {
                    io::Error::other(format!(
                        "Register an output binding for {} on {}",
                        feature.kind, feature.layer_id
                    ))
                })?;
                if !binding.publish
                    && before.as_ref().is_none_or(|previous| {
                        previous.kind != feature.kind || previous.layer_id != feature.layer_id
                    })
                {
                    return Err(io::Error::other(
                        "Inactive products only carry existing feature identities",
                    ));
                }
                representation(binding, &feature, records.networks)?;
            }
            if let Some(binding) = binding.filter(|b| b.publish) {
                representation(binding, &feature, records.networks)?;
                layers.insert(feature.layer_id);
            }
        }
        let mut coverage_scope = self.document.scope.clone();
        for field in &output.fields {
            let layer = self
                .channels
                .iter()
                .find(|b| field.channels.contains(&b.channel))
                .ok_or_else(|| io::Error::other("Completed fields require registered channels"))?
                .layer;
            if field.channels.iter().any(|name| {
                !self
                    .channels
                    .iter()
                    .any(|b| b.channel == *name && b.layer == layer)
            }) {
                return Err(io::Error::other("A field belongs to one registered layer"));
            }
            self.install_layer(layer)?;
            let metadata = output
                .resources
                .iter()
                .find(|r| r["id"] == field.output.resource_id)
                .ok_or_else(|| io::Error::other("Completed field resource is missing"))?;
            let descriptor: Descriptor = serde_json::from_value(metadata.clone())?;
            let stored = descriptor
                .field
                .as_ref()
                .ok_or_else(|| io::Error::other("Completed field retains its scope"))?;
            coverage_scope = stored.scope.clone();
            let samples = descriptor
                .arrays
                .iter()
                .find(|a| a.name == "active")
                .ok_or_else(|| io::Error::other("Completed field retains its sample layout"))?
                .shape
                .iter()
                .product::<usize>();
            let fields = self.document.world["fields"]
                .as_array_mut()
                .ok_or_else(|| io::Error::other("World fields are an array"))?;
            fields.retain(|f| f["id"] != field.output.field_id);
            fields.push(json!({"id":field.output.field_id, "areaId":stored.scope.located.area_id, "layerId":layer,
                "algorithm":"generation", "source":{"kind":"run", "id":operation}, "samples":samples,
                "channels":field.channels, "resourceId":field.output.resource_id, "state":"generated",
                "footprint":stored.scope.footprint, "spaceId":stored.scope.located.space_id}));
            union(
                &mut self.layers.get_mut(layer).unwrap().facts,
                &field.channels,
            );
            layers.insert(layer.into());
        }
        for layer in layers {
            self.install_layer(&layer)?;
            self.coverage(
                &coverage_scope,
                &layer,
                operation,
                &output.surface_id,
                spatial,
            )?;
            self.document.world["areas"][&coverage_scope.located.area_id.to_string()]["layers"]
                [&layer] = "generated".into();
        }
        Ok(())
    }
    fn coverage(
        &mut self,
        scope: &FieldScope,
        layer: &str,
        operation: &str,
        surface: &str,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<()> {
        let area = self
            .context
            .area(scope.located.area_id)
            .map_err(io::Error::other)?;
        if !area.owns_geography()
            && !spatial
                .relation(&area.footprint, &scope.footprint, Predicate::Covers)
                .map_err(io::Error::other)?
        {
            return Err(io::Error::other(
                "Materialization stays within its mapped area",
            ));
        }
        let id = semantic_id(
            scope.located.world_id,
            "generated-coverage",
            &format!("{}:{layer}", area.id),
        );
        let entry = json!({"id":id, "areaId":area.id, "spaceId":scope.located.space_id, "layerId":layer,
            "detailRank":area.profile as u8, "resolution":scope.resolution, "time":"present", "footprint":scope.footprint,
            "state":"generated", "resourceId":surface, "generationId":operation});
        if area.map.is_none() {
            for other in &self.document.coverage {
                let owner: atlas_map::Id = serde_json::from_value(other["areaId"].clone())
                    .map_err(|_| io::Error::other("Coverage needs an owner"))?;
                if self
                    .context
                    .area(owner)
                    .map_err(io::Error::other)?
                    .map
                    .is_some()
                    || !competing(&entry, other)
                    || self
                        .context
                        .descendant(area.id, owner)
                        .map_err(io::Error::other)?
                    || self
                        .context
                        .descendant(owner, area.id)
                        .map_err(io::Error::other)?
                {
                    continue;
                }
                let overlap = spatial
                    .overlay(
                        &scope.footprint,
                        &serde_json::from_value(other["footprint"].clone())?,
                        Overlay::Intersection,
                    )
                    .map_err(io::Error::other)?;
                if let Some(overlap) = overlap {
                    if spatial.area(&overlap).map_err(io::Error::other)? > 0.0 {
                        return Err(io::Error::other("Same-detail materialization has one owner for each layer, time and location"));
                    }
                }
            }
        }
        let text = id.to_string();
        self.document
            .coverage
            .retain(|entry| entry["id"] != text.as_str());
        self.document.coverage.push(entry);
        Ok(())
    }
}
fn competing(a: &Value, b: &Value) -> bool {
    a["id"] != b["id"]
        && a["areaId"] != b["areaId"]
        && b["state"] != "unmaterialized"
        && ["spaceId", "layerId", "detailRank", "time"]
            .iter()
            .all(|key| a[key] == b[key])
}
fn representation(
    binding: &Binding,
    feature: &Feature,
    network: &dyn NetworkReader,
) -> io::Result<()> {
    if !binding.network {
        return Ok(());
    }
    if let Some(reach) = network
        .reaches(Selection {
            feature_id: Some(feature.id),
            ..Default::default()
        })?
        .next()
    {
        let reach = reach?;
        if network.node(reach.start)?.is_some() && network.node(reach.end)?.is_some() {
            return Ok(());
        }
    }
    Err(io::Error::other(format!(
        "Publish {} with its network reach and endpoint nodes",
        feature.id
    )))
}
