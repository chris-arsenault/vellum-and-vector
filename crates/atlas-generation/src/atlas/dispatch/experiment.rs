//! Native callers can narrow or tune the prepared recipe through the same registry.
use super::{specifications::Specifications, Category, Specification};
use crate::{
    execution::{ExecutionError, ExecutionResult},
    processes::strategies::Site,
    recipe::{Configuration, Sequence, Stage},
    sequence::{SequenceNode, StageKind},
};
use serde::{Deserialize, Serialize};
// hpc-exempt: recipe occurrences and selectors, not numerical state.
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub process: String,
    pub invocation: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub target: Target,
    pub parameter: String,
    pub value: f64,
}

#[derive(Default)]
pub struct Experiment {
    /// None runs the whole recipe. Some restricts it to explicit targets and setup.
    pub only: Option<Vec<Target>>,
    pub changes: Vec<Change>,
}

impl Target {
    fn matches(&self, process: &str, path: &str) -> bool {
        self.process == process && self.invocation.as_deref().is_none_or(|id| id == path)
    }

    pub fn observes(&self, process: &str, path: &[String]) -> bool {
        let occurrence = super::schedule::occurrence_path(path);
        self.matches(process, &occurrence.join("/"))
    }
}

// owner-direction(2026-11-25): experiment process targets are limited to the subset migrated to the modern orchestrator
pub fn supported(specification: &Specification) -> bool {
    matches!(
        specification.category,
        Category::Semantic(_) | Category::ClassificationPublication
    )
}

fn eligible(
    specification: &Specification,
    site: Site,
    stage: &Stage<'_>,
    change: &Change,
) -> ExecutionResult<bool> {
    let Some(control) = specification
        .numeric
        .iter()
        .find(|c| c.name == change.parameter)
    else {
        return Err(ExecutionError::Failed(format!(
            "{} has no numeric control {}",
            change.target.process, change.parameter
        )));
    };
    if !control.map_types.is_empty() && !control.map_types.contains(&site.map_type) {
        return Ok(false);
    }
    let strategies = specification.strategy(site, stage)?;
    Ok(control
        .strategy
        .is_none_or(|name| strategies.iter().any(|s| s.name == name)))
}

impl Experiment {
    pub(crate) fn apply(
        &self,
        configuration: &mut Configuration,
        registry: &impl Specifications,
        site: Site,
    ) -> ExecutionResult<()> {
        if self.only.is_none() && self.changes.is_empty() {
            return Ok(());
        }
        let targets = self.only.as_deref().unwrap_or_default();
        if self.only.is_some() && targets.is_empty() {
            return Err(ExecutionError::Failed("Select at least one process".into()));
        }
        let mut selected = BTreeSet::new();
        let mut used_targets = BTreeSet::new();
        let mut used_changes = BTreeSet::new();
        let mut changes = BTreeMap::<String, BTreeSet<usize>>::new(); // hpc-exempt: recipe overrides by invocation.
        for stage in configuration
            .stages()
            .map_err(|error| ExecutionError::Failed(format!("{error:?}")))?
        {
            let StageKind::Process(call) = stage.kind else {
                continue;
            };
            let path = stage.context.path.join("/");
            let specification = registry.specification(call)?;
            if !call.enabled(&stage.context) || !specification.active(site, &stage)? {
                continue;
            }
            if setup(&call.process)
                || (call.process == "town.initialize"
                    && site.map_type == crate::processes::strategies::MapType::City
                    && targets.iter().any(|t| t.process.starts_with("town.")))
            {
                selected.insert(path.clone());
            }
            if !supported(specification) {
                continue;
            }
            for (index, _) in targets
                .iter()
                .enumerate()
                .filter(|(_, t)| t.matches(&call.process, &path))
            {
                used_targets.insert(index);
                selected.insert(path.clone());
            }
            if self.only.is_some() && !selected.contains(&path) {
                continue;
            }
            for (index, change) in self
                .changes
                .iter()
                .enumerate()
                .filter(|(_, c)| c.target.matches(&call.process, &path))
            {
                if eligible(specification, site, &stage, change)? {
                    used_changes.insert(index);
                    changes.entry(path.clone()).or_default().insert(index);
                }
            }
        }
        if let Some((_, target)) = targets
            .iter()
            .enumerate()
            .find(|(index, _)| !used_targets.contains(index))
        {
            return Err(unavailable("process", target, ""));
        }
        if let Some((_, change)) = self
            .changes
            .iter()
            .enumerate()
            .find(|(index, _)| !used_changes.contains(index))
        {
            return Err(unavailable(
                "numeric control",
                &change.target,
                &change.parameter,
            ));
        }
        self.edit(&mut configuration.sequence, "", &selected, &changes);
        Ok(())
    }

    fn edit(
        &self,
        sequence: &mut Sequence,
        prefix: &str,
        selected: &BTreeSet<String>,
        changes: &BTreeMap<String, BTreeSet<usize>>,
    ) {
        sequence.retain_mut(|node| match node {
            SequenceNode::Process { id, operation } => {
                let path = format!("{prefix}{id}");
                if self.only.is_some() && !selected.contains(&path) {
                    return false;
                }
                for &index in changes.get(&path).into_iter().flatten() {
                    let change = &self.changes[index];
                    operation
                        .parameters
                        .insert(change.parameter.clone(), change.value.into());
                }
                true
            }
            SequenceNode::Epochs { id, body, .. } => {
                self.edit(body, &format!("{prefix}{id}/"), selected, changes);
                self.only.is_none() || !body.is_empty()
            }
        });
    }
}

/// Construction binds the same captured fields and regional context as full generation.
fn setup(process: &str) -> bool {
    matches!(
        process,
        "atlas.initialize" | "refinement.begin" | "refinement.context"
    )
}

fn unavailable(kind: &str, target: &Target, parameter: &str) -> ExecutionError {
    ExecutionError::Failed(
        format!(
            "No applicable migrated {kind} for {} {} {}",
            target.process,
            target.invocation.as_deref().unwrap_or_default(),
            parameter
        )
        .trim_end()
        .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parameters::Values, processes::strategies::MapType, recipe::Invocation};

    fn recipe(process: &str) -> Configuration {
        Configuration {
            id: "example".into(),
            version: 1,
            parameters: Values::new(),
            inputs: Values::new(),
            sequence: vec![SequenceNode::Process {
                id: format!("round-1/{process}"),
                operation: Invocation {
                    process: process.into(),
                    version: "1".into(),
                    feature: None,
                    parameters: Values::new(),
                    when: None,
                },
            }],
        }
    }

    fn catalogue() -> super::super::specifications::Catalogue {
        super::super::specifications::Catalogue::atlas(
            &Default::default(),
            &[],
            &Default::default(),
            &Default::default(),
            true,
        )
        .unwrap()
    }

    fn site(map_type: MapType) -> Site {
        Site {
            map_type,
            cell_metres: 100.,
        }
    }

    #[test]
    fn migrated_control_defaults_and_overrides_use_the_normal_resolver() {
        let mut configuration = recipe("human.land.gather");
        let catalogue = catalogue();
        let resolved = |configuration: &Configuration| {
            let stage = configuration.stages().unwrap().remove(0);
            let StageKind::Process(call) = stage.kind else {
                panic!("expected process")
            };
            configuration
                .invocation_parameters(
                    &catalogue.specification(call).unwrap().parameters,
                    call,
                    &stage.context,
                )
                .unwrap()
        };
        assert_eq!(resolved(&configuration)["catchmentSpans"], 2.);
        let experiment = Experiment {
            only: None,
            changes: vec![Change {
                target: Target {
                    process: "human.land.gather".into(),
                    invocation: Some("round-1/human.land.gather".into()),
                },
                parameter: "catchmentSpans".into(),
                value: 4.,
            }],
        };
        assert!(experiment
            .apply(&mut configuration, &catalogue, site(MapType::Region))
            .is_err());
        experiment
            .apply(&mut configuration, &catalogue, site(MapType::City))
            .unwrap();
        let values = resolved(&configuration);
        assert_eq!(values["catchmentSpans"], 4.);
        assert_eq!(values["catchmentFalloff"], 3.);
    }

    #[test]
    fn legacy_processes_cannot_be_selected_as_experiment_targets() {
        let target = Target {
            process: "human.population-present".into(),
            invocation: None,
        };
        let mut configuration = recipe(&target.process);
        let experiment = Experiment {
            only: Some(vec![target]),
            changes: Vec::new(),
        };
        assert!(experiment
            .apply(&mut configuration, &catalogue(), site(MapType::Region))
            .is_err());
    }

    #[test]
    fn observation_matches_each_feedback_pass_of_a_selected_invocation() {
        let target = Target {
            process: "human.land.gather".into(),
            invocation: Some("round-1/human.land.gather".into()),
        };
        assert!(target.observes(
            "human.land.gather",
            &[
                "round-1/human.land.gather".into(),
                "feedback-society/2".into()
            ],
        ));
        assert!(!target.observes(
            "human.land.gather",
            &[
                "round-2/human.land.gather".into(),
                "feedback-society/2".into()
            ],
        ));
    }
}
