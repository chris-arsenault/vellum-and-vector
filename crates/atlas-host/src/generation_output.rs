//! Completed geography and local resources. No execution arena or restart state crosses this boundary.
use crate::{
    numerical_output::{Frame, Resources, Sink},
    numerical_resource::FieldScope,
};
use atlas_generation::{
    atlas::{
        history::{Cause, Diagnostic, EpochHistory, GenerationEpoch},
        preview::{self, Preview},
        state::State,
        workflow::{Boundary, Output},
    },
    control::GenerationControl,
    execution::{ExecutionError, ExecutionResult},
    field::projection::{channels::Quantity, Surface},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, future::Future, io};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldOutput {
    pub field_id: String,
    pub resource_id: String,
}
#[derive(PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Declaration {
    pub unit: String,
    pub quantity: Quantity,
    /// Inactive bindings and protected fields remain inputs without replacing published data.
    pub output: Option<FieldOutput>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plan {
    pub layout_id: String,
    pub surface_id: String,
    pub scope: FieldScope,
    pub precision: f64,
    pub channels: BTreeMap<String, Declaration>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenField {
    #[serde(flatten)]
    pub output: FieldOutput,
    pub channels: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completed {
    pub surface_id: String,
    pub surface_resource_id: String,
    pub fields: Vec<WrittenField>,
    pub resources: Vec<Value>,
    pub geography: Vec<Value>,
    pub history: Vec<EpochHistory>,
    pub causes: Vec<Cause>,
    pub entities: Value,
    pub landmarks: Value,
    pub drainage: Value,
}
/// UI observations carry progress and previews; domain validation stays in the Rust runtime.
pub trait Observations {
    fn completed_state(
        &mut self,
        _state: &State,
        _ancestry: Option<&[GenerationEpoch]>,
    ) -> ExecutionResult<()> {
        Ok(())
    }
    fn diagnostic(&mut self, diagnostic: &Diagnostic) -> ExecutionResult<()>;
    fn preview(
        &mut self,
        preview: &Preview,
        ancestry: Option<&[GenerationEpoch]>,
    ) -> impl Future<Output = ExecutionResult<()>>;
}
pub struct Publication<'a, S, C, O> {
    pub plan: Plan,
    pub bindings: crate::generation_bindings::Bindings,
    pub sink: &'a mut S,
    pub control: &'a C,
    pub observations: O,
    pub result: Option<Completed>,
}
impl<S: Sink, C: GenerationControl, O: Observations> Output for Publication<'_, S, C, O> {
    fn validate(&mut self, _state: &State) -> ExecutionResult<()> {
        Ok(())
    }
    fn diagnostic(&mut self, diagnostic: &Diagnostic) -> ExecutionResult<()> {
        self.observations.diagnostic(diagnostic)
    }
    async fn completed(&mut self, state: &State, boundary: Boundary<'_>) -> ExecutionResult<()> {
        let town_epoch;
        let mut preview = preview::capture(state)?;
        let ancestry = match boundary {
            Boundary::Epoch(ancestry) => Some(ancestry),
            Boundary::Town(stage) => {
                preview.town_fabric = Some(preview::town::capture(&state.town, stage, state)?);
                town_epoch = [GenerationEpoch {
                    id: format!("Town {} (round {})", stage.phase, stage.round),
                    duration: 0.,
                    parent_epoch: None,
                    variables: Default::default(),
                }];
                Some(town_epoch.as_slice())
            }
            Boundary::Final => None,
        };
        self.observations.completed_state(state, ancestry)?;
        if preview.channels.contains_key("Elevation") {
            self.observations.preview(&preview, ancestry).await?;
        }
        if ancestry.is_none() {
            self.result = Some(self.write(state).await?);
        }
        Ok(())
    }
}
impl<S: Sink, C: GenerationControl, O: Observations> Publication<'_, S, C, O> {
    async fn write(&mut self, state: &State) -> ExecutionResult<Completed> {
        let entities = serde_json::to_value(&state.people.memory.borrow().entities)
            .map_err(io::Error::other)?;
        self.plan.channels = self
            .bindings
            .channels(&state.people.memory.borrow().entities)?;
        let fields = self.plan.groups(&state.physical.surface)?;
        let mut result = Completed {
            surface_id: self.plan.surface_id.clone(),
            surface_resource_id: fields.first().map_or_else(
                || format!("{}:surface", self.plan.layout_id),
                |field| field.output.resource_id.clone(),
            ),
            fields,
            resources: Vec::new(),
            geography: Vec::new(),
            history: state.history.clone(),
            causes: state.causes.clone(),
            entities,
            landmarks: serde_json::to_value(&state.physical.landmarks).map_err(io::Error::other)?,
            drainage: serde_json::to_value(&state.drainage).map_err(io::Error::other)?,
        };
        // Completed immutable resources remain available to a publication retry.
        self.write_resources(state, &mut result).await?;
        Ok(result)
    }
    async fn write_resources(
        &mut self,
        state: &State,
        result: &mut Completed,
    ) -> ExecutionResult<()> {
        let surface = &state.physical.surface;
        let mut frame = Frame {
            field_id: self.plan.layout_id.clone(),
            scope: self.plan.scope.clone(),
            precision: self.plan.precision,
        };
        frame
            .scope
            .footprint
            .clone_from(&state.physical.field_footprint);
        let resources = Resources::new(surface, &self.plan.layout_id, &frame)?;
        result
            .resources
            .push(resources.layout.write(self.sink, self.control).await?);
        if let Some(tree) = &resources.tree {
            result
                .resources
                .push(tree.write(self.sink, self.control).await?);
        }
        for field in &result.fields {
            // Current Grid.id is the immutable sample resource identity, not the catalog Field.id.
            frame.field_id.clone_from(&field.output.resource_id);
            let resource =
                resources.channels(surface, &field.output.resource_id, &frame, &field.channels)?;
            result
                .resources
                .push(resource.write(self.sink, self.control).await?);
        }
        if result.fields.is_empty() {
            // Feature-only runs still return their actual sample mask and topology.
            frame.field_id.clone_from(&result.surface_resource_id);
            let resource = resources.channels(surface, &result.surface_resource_id, &frame, &[])?;
            result
                .resources
                .push(resource.write(self.sink, self.control).await?);
        }
        result.geography.push(serde_json::json!({
            "id": self.plan.layout_id,
            "scope": self.plan.scope.located,
            "ocean": state.physical.ocean,
            "lakes": state.physical.lakes.iter().map(|lake| serde_json::json!({
                "id": lake.id, "geometry": lake.geometry, "level": lake.level,
            })).collect::<Vec<_>>(),
        }));
        Ok(())
    }
}
impl Plan {
    fn groups(&self, surface: &Surface) -> ExecutionResult<Vec<WrittenField>> {
        let mut groups: BTreeMap<String, WrittenField> = BTreeMap::new();
        for (name, channel) in surface.channels() {
            let declaration = self.channels.get(name).ok_or_else(|| {
                ExecutionError::Failed(format!("Register an output binding for {name}"))
            })?;
            if channel.unit != declaration.unit || channel.quantity != declaration.quantity {
                return Err(ExecutionError::Failed(format!(
                    "{name} must retain its registered unit and quantity"
                )));
            }
            let Some(output) = &declaration.output else {
                continue;
            };
            let group = groups
                .entry(output.field_id.clone())
                .or_insert_with(|| WrittenField {
                    output: output.clone(),
                    channels: Vec::new(),
                });
            if group.output != *output {
                return Err(ExecutionError::Failed(
                    "One field requires one sample resource".into(),
                ));
            }
            group.channels.push(name.clone());
        }
        Ok(groups.into_values().collect())
    }
}
