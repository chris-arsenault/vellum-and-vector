//! Feature-owned executable contributions shared by world and regional policies.
mod domain;
mod physical;
use super::native::{NativeStep, NativeSteps};
use crate::{
    execution::ExecutionResult,
    parameters::Values,
    recipe::{Invocation, Sequence},
    sequence::SequenceNode,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, io, rc::Rc};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Selected {
    pub enabled: bool,
    #[serde(default)]
    pub settings: Values,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configuration: Option<Values>,
}
// hpc-exempt: feature selection metadata, never numerical field storage.
pub type Selection = BTreeMap<String, Selected>;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    World,
    Regional,
}
#[derive(Clone)]
pub struct Context<'a> {
    pub selection: &'a Selection,
    pub policy: Policy,
    pub refinement: bool,
    pub landmarks_apply: bool,
    pub standalone_magic: bool,
    pub initial: bool,
    pub material: bool,
    pub process: Option<&'a str>,
}
impl Context<'_> {
    pub fn enabled(&self, id: &str) -> bool {
        self.selection.get(id).is_some_and(|value| value.enabled)
    }
    fn for_process<'a>(&'a self, process: &'a str) -> Context<'a> {
        Context {
            selection: self.selection,
            policy: self.policy,
            refinement: self.refinement,
            landmarks_apply: self.landmarks_apply,
            standalone_magic: self.standalone_magic,
            initial: self.initial,
            material: self.material,
            process: Some(process),
        }
    }
}
type Contribution = Rc<dyn Fn(&str, &Context<'_>) -> Sequence>;
pub struct Feature {
    pub id: &'static str,
    pub domains: &'static [&'static str],
    pub requires: &'static [&'static str],
    pub absent: &'static [&'static str],
    pub parameters: &'static [&'static str],
    pub processes: Vec<String>,
    pub native: Vec<&'static str>,
    pub slots: Vec<&'static str>,
    contribute: Contribution,
}
pub fn invoke(process: &str, parameters: Values) -> SequenceNode<Invocation, Values> {
    SequenceNode::Process {
        id: process.into(),
        operation: Invocation {
            process: process.into(),
            version: "1".into(),
            feature: None,
            parameters,
            when: None,
        },
    }
}
pub(super) fn operations(processes: &[&str]) -> Sequence {
    processes
        .iter()
        .map(|process| invoke(process, Values::new()))
        .collect()
}
impl Feature {
    pub fn contribution(&self, slot: &str, context: &Context<'_>) -> io::Result<Sequence> {
        if !context.enabled(self.id) || !self.slots.contains(&slot) {
            return Ok(Vec::new());
        }
        let mut body = (self.contribute)(slot, context);
        self.bind(slot, &mut body)?;
        Ok(body)
    }
    fn bind(&self, slot: &str, body: &mut Sequence) -> io::Result<()> {
        for node in body {
            match node {
                SequenceNode::Epochs { id, body, .. } => {
                    *id = format!("{}/{slot}/{id}", self.id);
                    self.bind(slot, body)?;
                }
                SequenceNode::Process { id, operation } => {
                    if !self.processes.contains(&operation.process) {
                        return Err(io::Error::other(format!(
                            "{} cannot contribute unowned process {}",
                            self.id, operation.process
                        )));
                    }
                    *id = format!("{}/{slot}/{id}", self.id);
                    operation.feature = Some(self.id.into());
                }
            }
        }
        Ok(())
    }
}
pub struct Catalogue {
    pub features: Vec<Feature>,
}
impl Default for Catalogue {
    fn default() -> Self {
        Self {
            features: physical::features()
                .into_iter()
                .chain(domain::features())
                .collect(),
        }
    }
}
impl Catalogue {
    pub fn contribute(&self, slot: &str, context: &Context<'_>) -> io::Result<Sequence> {
        self.features
            .iter()
            .try_fold(Vec::new(), |mut body, feature| {
                body.extend(feature.contribution(slot, context)?);
                Ok(body)
            })
    }
    /// Native providers come from the feature's operation definitions, including regional alternatives.
    pub fn selected_native<'a>(
        &self,
        selection: &Selection,
        definitions: &'a NativeSteps,
    ) -> ExecutionResult<Vec<&'a NativeStep>> {
        let mut selected = Vec::new();
        for feature in &self.features {
            if !selection
                .get(feature.id)
                .is_some_and(|choice| choice.enabled)
            {
                continue;
            }
            for name in &feature.native {
                if selected.iter().any(|step: &&NativeStep| step.name == *name) {
                    continue;
                }
                selected.push(definitions.get(name)?);
            }
        }
        Ok(selected)
    }
    pub fn compose(
        &self,
        slot: &str,
        occurrence: &str,
        context: &Context<'_>,
        parameters: &Values,
    ) -> io::Result<Sequence> {
        let mut result = Vec::new();
        for mut node in self.contribute(slot, context)? {
            if let SequenceNode::Process { operation, .. } = &mut node {
                let hooks = context.for_process(&operation.process);
                result.extend(self.contribute("before.model-pass", &hooks)?);
                let native = operation
                    .process
                    .strip_prefix("atlas.")
                    .is_some_and(|name| self.features.iter().any(|f| f.native.contains(&name)));
                if native {
                    let mut merged = parameters.clone();
                    merged.append(&mut operation.parameters);
                    operation.parameters = merged;
                }
                let after =
                    self.contribute("after.model-pass", &context.for_process(&operation.process))?;
                result.push(node);
                result.extend(after);
            } else {
                result.push(node);
            }
        }
        for node in &mut result {
            let (SequenceNode::Process { id, .. } | SequenceNode::Epochs { id, .. }) = node;
            *id = format!("{occurrence}/{id}");
        }
        Ok(result)
    }
    pub fn plate_deformation<'a>(
        &self,
        context: &Context<'_>,
        native: &'a NativeSteps,
    ) -> ExecutionResult<Vec<&'a NativeStep>> {
        let mut steps = Vec::new();
        for slot in [
            "epoch.mountains",
            "material.hillslopes",
            "material.support.before-margins",
        ] {
            for node in self.contribute(slot, context)? {
                if let SequenceNode::Process { operation, .. } = node {
                    if let Some(name) = operation.process.strip_prefix("atlas.") {
                        if self.features.iter().any(|f| f.native.contains(&name)) {
                            steps.push(native.get(name)?);
                        }
                    }
                }
            }
        }
        Ok(steps)
    }
}
pub fn work_span(span: f64) -> Values {
    Values::from_iter([("workSpan".into(), Value::from(span))])
}
