//! Completed numerical resource identities and publication bindings, owned by the producer.
use crate::{
    generation_output::{Declaration, FieldOutput, Plan},
    generation_request::PreparedRequest,
    numerical_resource::FieldScope,
};
use atlas_generation::{
    features::records::{Entity, State},
    identity::semantic_id,
    publication::channels::Inputs,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingField {
    pub id: String,
    pub state: Option<State>,
    pub channels: Option<Vec<String>>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub operation_id: String,
    pub seed: i32,
    pub scope: FieldScope,
    pub precision: f64,
    pub fields: Vec<ExistingField>,
}
pub struct Bindings {
    input: Input,
    selection: atlas_generation::atlas::features::Selection,
    systems: Vec<atlas_generation::magic::configuration::System>,
    confluences: Vec<atlas_generation::magic::confluences::configuration::Confluence>,
    sources: Vec<atlas_generation::field::landmarks::magic::Source>,
    inherited: BTreeSet<String>,
}
impl Bindings {
    // owner-direction(2026-11-14): map production belongs in Rust; TypeScript is UI, view code and facade.
    pub fn new(mut input: Input, prepared: &PreparedRequest) -> io::Result<(Self, Plan)> {
        input.scope = prepared.geography.scope.clone();
        input.precision = prepared.geography.frame.scope.precision;
        let request = &prepared.request;
        let bindings = Self {
            inherited: input
                .fields
                .iter()
                .flat_map(|field| field.channels.iter().flatten().cloned())
                .collect(),
            input,
            selection: prepared.resolved.selection.clone(),
            systems: prepared.resolved.settings.magic_systems.clone(),
            confluences: prepared.resolved.settings.confluences.clone(),
            sources: request.magic_sources.clone(),
        };
        let scope = &bindings.input.scope;
        let plan = Plan {
            layout_id: format!("{}:layout:0", bindings.input.operation_id),
            surface_id: semantic_id(
                &scope.located.world_id,
                "surface",
                &format!("{}:{}", scope.located.area_id, bindings.input.seed),
            )?,
            scope: scope.clone(),
            precision: bindings.input.precision,
            channels: bindings.channels(&request.entities)?,
        };
        Ok((bindings, plan))
    }
    pub fn channels(
        &self,
        entities: &BTreeMap<String, Entity>,
    ) -> io::Result<BTreeMap<String, Declaration>> {
        let mut result = BTreeMap::new();
        let world = &self.input.scope.located.world_id;
        let area = &self.input.scope.located.area_id;
        for binding in (Inputs {
            selection: &self.selection,
            systems: &self.systems,
            confluences: &self.confluences,
            sources: &self.sources,
            inherited: &self.inherited,
        })
        .bindings(entities)
        {
            let field_id = semantic_id(world, "atlas-field", &format!("{area}:{}", binding.layer))?;
            let protected = self.input.fields.iter().any(|field| {
                field.id == field_id
                    && matches!(field.state, Some(State::Authored | State::Protected))
            });
            let output = if binding.publish && !protected {
                Some(FieldOutput {
                    field_id,
                    resource_id: semantic_id(
                        world,
                        "atlas-samples",
                        &format!("{}:{}", self.input.operation_id, binding.layer),
                    )?,
                })
            } else {
                None
            };
            let declaration = Declaration {
                unit: binding.unit.into(),
                quantity: binding.quantity,
                output,
            };
            if let Some(previous) = result.insert(binding.channel.clone(), declaration) {
                if previous != result[&binding.channel] {
                    return Err(io::Error::other(format!(
                        "Register one publication binding for channel {}",
                        binding.channel
                    )));
                }
            }
        }
        Ok(result)
    }
}
