//! Nested causal epochs carry explicit ancestry; invocation references stay selected operations.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Epoch<Variables> {
    pub id: String,
    pub duration: f64,
    pub parent_epoch: Option<String>,
    pub variables: Variables,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SequenceNode<Operation, Variables> {
    Process {
        id: String,
        #[serde(flatten)]
        operation: Operation,
    },
    Epochs {
        id: String,
        epochs: Vec<Epoch<Variables>>,
        reset_facts: Vec<String>,
        body: Vec<Self>,
    },
}
impl<O, V> SequenceNode<O, V> {
    fn id(&self) -> &str {
        match self {
            Self::Process { id, .. } | Self::Epochs { id, .. } => id,
        }
    }
}
pub struct InvocationContext<'a, V> {
    pub path: Vec<String>,
    pub epochs: Vec<&'a Epoch<V>>,
    pub epoch_indices: Vec<usize>,
}
impl<V> Clone for InvocationContext<'_, V> {
    fn clone(&self) -> Self {
        Self {
            path: self.path.clone(),
            epochs: self.epochs.clone(),
            epoch_indices: self.epoch_indices.clone(),
        }
    }
}
impl<V> InvocationContext<'_, V> {
    pub fn duration(&self) -> Option<f64> {
        self.epochs.last().map(|epoch| epoch.duration)
    }
    /// An era's loop ordinal is not its physical clock; the first explicit binding wins.
    pub fn physical_epoch_index(
        &self,
        physical_ids: &[String],
    ) -> Result<Option<usize>, SequenceError> {
        let parent = self
            .epochs
            .iter()
            .find_map(|epoch| epoch.parent_epoch.as_ref());
        parent
            .map(|parent| {
                physical_ids
                    .iter()
                    .position(|id| id == parent)
                    .ok_or_else(|| SequenceError::UnknownPhysicalEpoch(parent.clone()))
            })
            .transpose()
    }
}
pub enum StageKind<'a, O> {
    Process(&'a O),
    EpochStart(&'a [String]),
    EpochEnd,
}
pub struct SequenceStage<'a, O, V> {
    pub kind: StageKind<'a, O>,
    pub context: InvocationContext<'a, V>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SequenceError {
    DuplicateInvocation(String),
    InvalidEpochSchedule(String),
    InvalidEpochDuration(String),
    EmptyResetFact(String),
    UnknownPhysicalEpoch(String),
}

pub fn stages<O, V>(
    sequence: &[SequenceNode<O, V>],
) -> Result<Vec<SequenceStage<'_, O, V>>, SequenceError> {
    let context = InvocationContext {
        path: Vec::new(),
        epochs: Vec::new(),
        epoch_indices: Vec::new(),
    };
    let mut result = Vec::new();
    expand(sequence, &context, &mut result)?;
    Ok(result)
}
fn expand<'a, O, V>(
    sequence: &'a [SequenceNode<O, V>],
    context: &InvocationContext<'a, V>,
    result: &mut Vec<SequenceStage<'a, O, V>>,
) -> Result<(), SequenceError> {
    let mut ids = BTreeSet::new();
    for node in sequence {
        if !ids.insert(node.id()) {
            return Err(SequenceError::DuplicateInvocation(node.id().into()));
        }
        let mut next = context.clone();
        next.path.push(node.id().into());
        match node {
            SequenceNode::Process { operation, .. } => result.push(SequenceStage {
                kind: StageKind::Process(operation),
                context: next,
            }),
            SequenceNode::Epochs {
                id,
                epochs,
                reset_facts,
                body,
            } => {
                validate_epochs(id, epochs, reset_facts)?;
                for (index, epoch) in epochs.iter().enumerate() {
                    let mut epoch_context = next.clone();
                    epoch_context.epochs.push(epoch);
                    epoch_context.epoch_indices.push(index);
                    result.push(SequenceStage {
                        kind: StageKind::EpochStart(reset_facts),
                        context: epoch_context.clone(),
                    });
                    expand(body, &epoch_context, result)?;
                    result.push(SequenceStage {
                        kind: StageKind::EpochEnd,
                        context: epoch_context,
                    });
                }
            }
        }
    }
    Ok(())
}
fn validate_epochs<V>(
    id: &str,
    epochs: &[Epoch<V>],
    reset_facts: &[String],
) -> Result<(), SequenceError> {
    let mut ids = BTreeSet::new();
    if epochs.is_empty() || epochs.iter().any(|epoch| !ids.insert(&epoch.id)) {
        return Err(SequenceError::InvalidEpochSchedule(id.into()));
    }
    if reset_facts.iter().any(String::is_empty) {
        return Err(SequenceError::EmptyResetFact(id.into()));
    }
    for epoch in epochs {
        if !epoch.duration.is_finite() || epoch.duration < 0.0 {
            return Err(SequenceError::InvalidEpochDuration(epoch.id.clone()));
        }
    }
    Ok(())
}
