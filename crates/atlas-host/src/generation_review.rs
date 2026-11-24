//! Read-only configuration review. Only resource descriptors are needed, never numerical arrays.
use crate::{
    generation_request::PreparedRequest,
    numerical_input::Array,
    numerical_resource::{Descriptor, Opened, Store},
};
use atlas_generation::{
    atlas::{
        configuration::{self, presentation},
        workspace::inputs::Selection,
    },
    publication::channels,
    spatial::SpatialKernel,
};
use serde_json::Value;
use std::{collections::BTreeSet, io};

/// A regional review uses the same captured descriptors as execution without persisting them.
pub struct Descriptors<'a> {
    pub captured: &'a [Descriptor],
    pub store: &'a dyn Store,
}
impl Store for Descriptors<'_> {
    fn describe(&self, id: &str) -> io::Result<Descriptor> {
        match self.captured.iter().find(|resource| resource.id == id) {
            Some(resource) => Ok(resource.clone()),
            None => self.store.describe(id),
        }
    }
    fn open(&self, _: &str, _: &Array) -> io::Result<Opened> {
        Err(io::Error::other(
            "Configuration review does not read numerical arrays",
        ))
    }
}
impl PreparedRequest {
    // Arconis: docs/architecture/subsystems.arconis#item=j_review — checks the setup without reading numerical arrays.
    pub fn review(&self, spatial: &dyn SpatialKernel) -> io::Result<Value> {
        let request = &self.request;
        let frame = &self.geography.frame;
        let selection = Selection {
            scope: &frame.scope,
            owned_geography: request.capture.owned_geography,
            reopened: request.capture.reopened,
            ancestors: &request.capture.ancestors,
        };
        let mut inherited = BTreeSet::new();
        for field in &request.capture.fields {
            if selection.accepts(field.area, field.space, field.input)
                && selection.supports(field.input, &field.footprint, spatial)?
            {
                inherited.extend(field.source.channels.iter().cloned());
            }
        }
        let sources = crate::generation_rules::located_sources(
            &request.magic_sources,
            &self.geography,
            self.resolved.settings.epochs.len(),
            spatial,
        )?;
        let publications = channels::Inputs {
            selection: &self.resolved.selection,
            systems: &self.resolved.settings.magic_systems,
            confluences: &self.resolved.settings.confluences,
            sources: &request.magic_sources,
            inherited: &inherited,
        }
        .bindings(&request.entities);
        let review = presentation::review(
            &request.input,
            &self.resolved,
            &configuration::Frame {
                profile: frame.profile,
                regional: request.region.is_some(),
                city: frame.scope.city.is_some(),
                inherited: frame.has_parent,
                landmarks_apply: !frame.has_parent || !request.landmarks.is_empty(),
                standalone_magic: !sources.is_empty(),
            },
            presentation::Context {
                site: frame.frame().process_site()?,
                inherited: frame.has_parent,
                completed: request.geography.has_generated_geography(),
                profile: frame.profile,
                channels: &inherited,
                located_sources: sources.len(),
                landmarks: request.landmarks.len(),
            },
            &publications,
        )?;
        let mut result = serde_json::to_value(review)?;
        result["input"] = serde_json::to_value(&request.input)?;
        result["input"]["settings"] = serde_json::to_value(&self.resolved.settings)?;
        result["input"]["parameters"] = serde_json::to_value(&self.resolved.parameters)?;
        result["input"]["features"] = serde_json::to_value(&self.resolved.selection)?;
        let controls = configuration::cartography::controls()?;
        let choices = controls
            .iter()
            .map(|control| {
                Ok((
                    control["id"].as_str().unwrap_or_default().to_owned(),
                    serde_json::to_value(configuration::cartography::selected(
                        control,
                        &request.input.features,
                    )?)?,
                ))
            })
            .collect::<io::Result<serde_json::Map<String, Value>>>()?;
        result["cartography"] = Value::Object(choices);
        result["landmarks"] = serde_json::to_value(&request.landmarks)?;
        result["sources"] = serde_json::to_value(&sources)?;
        result["resolutions"] = self.resolutions()?;
        Ok(result)
    }
    fn resolutions(&self) -> io::Result<Value> {
        use atlas_generation::atlas::resolution::Quality;
        let frame = &self.geography.frame;
        let area = (frame.bounds.2 - frame.bounds.0) * (frame.bounds.3 - frame.bounds.1);
        let region = self.request.geography.areas[&self.request.input.area_id]
            .area
            .map
            .as_ref();
        let mut choices = Vec::new();
        for quality in [Quality::Draft, Quality::Standard, Quality::Fine] {
            let span = match region {
                // A real-scale map keeps the detail it was opened at.
                Some(map) if map.real_scale.is_some() => {
                    map.real_scale.map_or(0.0, |real| real.cell_span())
                }
                Some(map) => quality
                    .regional_span(map.refinement_level.max(1))
                    .map_err(io::Error::other)?,
                None => quality.cell_span(frame.profile).map_err(io::Error::other)?,
            };
            let cells = (area / (span * span)).ceil();
            choices.push(serde_json::json!({"quality":quality,"cellAreaKm2":span * span / 1e6,"cells":cells,"aboveDefault":cells > 60_000.0}));
        }
        Ok(serde_json::json!(choices))
    }
}
