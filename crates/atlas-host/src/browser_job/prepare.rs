use super::{error, Action, BrowserJob, Prepared};
use crate::{
    generation_frame::Geography,
    generation_submission::Submission,
    generation_world::CreateWorld,
    local_inputs::LocalInputs,
    native_resources::NativeResources,
    numerical_resource::Scope,
    regional_capture::{self, Source},
};
use atlas_generation::features::{network::NetworkWorkspace, FeatureWorkspace};
use atlas_gis::geometry::NativeGeos;
use serde_json::Value;
use std::io;
use wasm_bindgen::prelude::*;

impl BrowserJob {
    pub(super) fn prepare(
        &self,
        action: Action,
        operation: atlas_map::Id,
    ) -> Result<Prepared, JsValue> {
        let (configuration, reference, expected, parent, selection, document, area) = match action {
            Action::Create(configuration) => {
                let configuration = configuration.normalize().map_err(error)?;
                let input = configuration.input(atlas_map::Id::NIL).map_err(error)?;
                let document = CreateWorld {
                    id: configuration
                        .world_id
                        .unwrap_or_else(crate::generation_world::random_id),
                    name: configuration.name.clone(),
                    seed: input.seed,
                    width: configuration.width,
                    height: configuration.height,
                    settings: input.settings,
                    boundary_mode: None,
                }
                .create()
                .map_err(error)?;
                let area = document.scope.located.area_id;
                (configuration, None, None, None, None, document, area)
            }
            Action::Regenerate {
                reference,
                configuration,
            } => {
                let map = self.maps.open(&reference).map_err(error)?;
                let document = self.private.document(&reference).map_err(error)?;
                (
                    configuration.normalize().map_err(error)?,
                    Some(reference.clone()),
                    Some(reference.clone()),
                    map.parent,
                    None,
                    document,
                    reference.map_id,
                )
            }
            Action::Refine(request) => {
                let parent = request.selection.parent.clone();
                let document = self.private.document(&parent).map_err(error)?;
                let area = crate::generation_world::random_id();
                let name = request.configuration.name.clone();
                (
                    request.configuration.normalize().map_err(error)?,
                    Some(parent.clone()),
                    None,
                    Some(parent),
                    Some(crate::regional_capture::Child {
                        selection: request.selection,
                        name,
                        real_scale: request.real_scale,
                        city: request.city,
                    }),
                    document,
                    area,
                )
            }
        };
        if let Some(reference) = reference {
            self.private
                .load_records(
                    &reference,
                    &mut self.records.source_features(),
                    &mut self.records.source_networks(),
                )
                .map_err(error)?;
        }
        let input = configuration.input(area).map_err(error)?;
        let mut prepared = Prepared {
            submission: Submission {
                source: document,
                input,
            },
            expected,
            parent,
            creates_child: selection.is_some(),
            selection,
            geography: Vec::new(),
            resources: Vec::new(),
        };
        if prepared.selection.is_some() {
            prepared = self.capture(prepared, operation)?;
        }
        Ok(prepared)
    }
    fn capture(
        &self,
        mut prepared: Prepared,
        operation: atlas_map::Id,
    ) -> Result<Prepared, JsValue> {
        let child = prepared.selection.take().unwrap();
        let (selection, name) = (&child.selection, &child.name);
        let map = self.maps.open(&selection.parent).map_err(error)?;
        let geography: Geography =
            serde_json::from_value(prepared.submission.source.world.clone()).map_err(error)?;
        let spatial =
            NativeGeos::new(geography.reference.precision.unwrap_or(1e-6)).map_err(error)?;
        let capture = regional_capture::Selection {
            parent: &map,
            selection,
            id: prepared.submission.input.area_id,
            name,
            operation,
            real_scale: child.real_scale(prepared.submission.input.quality),
            city: child.city,
        };
        let captured = regional_capture::capture(
            capture,
            prepared.submission.source,
            &Inputs {
                resources: self.resources.as_ref(),
                private: &self.private,
            },
            regional_capture::PublishedMap {
                maps: &self.maps,
                files: &self.assets,
            },
            &self.records.source_features(),
            &spatial,
        )
        .map_err(error)?;
        prepared.resources = captured.resources;
        self.records.clear_source().map_err(error)?;
        for feature in captured.features {
            self.records.source_features().put(feature).map_err(error)?;
        }
        for node in captured.nodes {
            self.records
                .source_networks()
                .put_node(node)
                .map_err(error)?;
        }
        for reach in captured.reaches {
            self.records
                .source_networks()
                .put_reach(reach)
                .map_err(error)?;
        }
        prepared.submission.source = captured.document;
        prepared.geography = captured.geography;
        Ok(prepared)
    }
}
struct Inputs<'a> {
    resources: &'a NativeResources,
    private: &'a LocalInputs,
}
impl Source for Inputs<'_> {
    fn resource(&self, id: &str) -> io::Result<crate::numerical_resource::Descriptor> {
        use crate::numerical_resource::Store;
        self.resources.describe(id)
    }
    fn geography(&self, scope: &Scope, id: &str) -> io::Result<Value> {
        self.private.geography(scope, id)
    }
}
