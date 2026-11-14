//! The current configured process recipe. Epochs stay nested; no saved execution state.
pub mod random;
use crate::{
    parameters::{self, Definitions, Values},
    sequence::{self, InvocationContext, SequenceError, SequenceNode, SequenceStage},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io;

#[derive(Clone, Serialize, Deserialize)]
pub struct Condition {
    pub variable: String,
    pub equals: Value,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Invocation {
    pub process: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    #[serde(default)]
    pub parameters: Values,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<Condition>,
}
pub type Sequence = Vec<SequenceNode<Invocation, Values>>;
pub type Stage<'a> = SequenceStage<'a, Invocation, Values>;
#[derive(Clone, Serialize, Deserialize)]
pub struct Configuration {
    pub id: String,
    pub version: u32,
    pub parameters: Values,
    pub sequence: Sequence,
    #[serde(default)]
    pub inputs: Values,
}
impl Invocation {
    pub fn enabled(&self, context: &InvocationContext<'_, Values>) -> bool {
        self.when.as_ref().is_none_or(|condition| {
            context
                .epochs
                .iter()
                .rev()
                .find_map(|epoch| epoch.variables.get(&condition.variable))
                .is_some_and(|value| parameters::scalar_equal(value, &condition.equals))
        })
    }
}
impl Configuration {
    pub fn stages(&self) -> Result<Vec<Stage<'_>>, SequenceError> {
        sequence::stages(&self.sequence)
    }
    pub fn invocation_parameters(
        &self,
        definitions: &Definitions,
        invocation: &Invocation,
        context: &InvocationContext<'_, Values>,
    ) -> io::Result<Values> {
        let relevant = |values: &Values| -> Values {
            values
                .iter()
                .filter(|(key, _)| definitions.contains_key(*key))
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        };
        let global = relevant(&self.parameters);
        let owned = invocation
            .feature
            .as_ref()
            .and_then(|feature| {
                self.inputs
                    .get("features")?
                    .get("selection")?
                    .get(feature)?
                    .get("settings")?
                    .as_object()
            })
            .map(relevant)
            .unwrap_or_default();
        let mut variables = Values::new();
        for epoch in &context.epochs {
            variables.extend(relevant(&epoch.variables));
        }
        parameters::resolve(
            definitions,
            [&global, &owned, &variables, &invocation.parameters],
        )
    }
}
