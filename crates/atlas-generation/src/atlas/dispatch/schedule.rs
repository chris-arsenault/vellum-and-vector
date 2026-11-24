//! Order registered calls within the recipe's existing epoch boundaries.
use super::{specifications::Specifications, Category, Schedule, Specification};
use crate::{
    execution::{ExecutionError, ExecutionResult},
    processes::strategies::{EffectTime, Site},
    recipe::{Configuration, Stage},
    sequence::StageKind,
};
use std::collections::BTreeSet;

pub(super) fn stages<'a>(
    configuration: &'a Configuration,
    registry: &impl Specifications,
    site: Site,
) -> ExecutionResult<Vec<Stage<'a>>> {
    let recipe = configuration
        .stages()
        .map_err(|error| fail(format!("{error:?}")))?;
    let mut ordered = Vec::with_capacity(recipe.len());
    let mut calls = Vec::new();
    for stage in recipe {
        if let StageKind::Process(call) = stage.kind {
            let specification = registry.specification(call)?;
            let enabled = call.enabled(&stage.context) && specification.active(site, &stage)?;
            calls.push(Call {
                stage,
                specification,
                enabled,
            });
        } else {
            compile(&mut ordered, std::mem::take(&mut calls), site)?;
            ordered.push(stage);
        }
    }
    compile(&mut ordered, calls, site)?;
    Ok(ordered)
}

struct Call<'a, 'r> {
    stage: Stage<'a>,
    specification: &'r Specification,
    enabled: bool,
}

struct Unit {
    module: &'static str,
    schedule: Schedule,
    calls: Vec<usize>,
}

fn fail(message: impl Into<String>) -> ExecutionError {
    ExecutionError::Failed(message.into())
}

fn compile<'a>(
    result: &mut Vec<Stage<'a>>,
    calls: Vec<Call<'a, '_>>,
    site: Site,
) -> ExecutionResult<()> {
    if calls.iter().all(|call| {
        let schedule = call.specification.schedule;
        schedule.stage.is_none() && schedule.after.is_empty() && schedule.feedback.is_none()
    }) {
        result.extend(calls.into_iter().map(|call| call.stage));
        return Ok(());
    }
    let (units, owners) = partition(&calls, site)?;
    let mut outside = vec![BTreeSet::new(); units.len()];
    let mut inside = vec![BTreeSet::new(); calls.len()];
    for (index, call) in calls.iter().enumerate().filter(|(_, call)| call.enabled) {
        for target in dependencies(call, &calls, &units[owners[index]].calls)? {
            let from = owners[index];
            let to = owners[target];
            if from != to {
                outside[from].insert(to);
            } else if units[from].schedule.feedback.is_none() {
                inside[index].insert(target);
            }
        }
    }
    let indices = (0..units.len()).collect::<Vec<_>>();
    for unit in order(
        &indices,
        &outside,
        |_| 0,
        "causal stages and feedback groups",
    )? {
        let unit = &units[unit];
        let description = unit.schedule.stage.unwrap_or("recipe occurrence");
        let chosen = order(
            &unit.calls,
            &inside,
            |i| calls[i].specification.schedule.order,
            description,
        )?;
        emit(result, &calls, &chosen, unit.schedule);
    }
    Ok(())
}

fn partition(calls: &[Call<'_, '_>], site: Site) -> ExecutionResult<(Vec<Unit>, Vec<usize>)> {
    let mut units: Vec<Unit> = Vec::new();
    let mut owners = Vec::with_capacity(calls.len());
    for (index, call) in calls.iter().enumerate() {
        let schedule = call.specification.schedule;
        validate_feedback(call, site)?;
        let joined = units.last_mut().filter(|unit| {
            schedule.stage.is_some()
                && unit.schedule.stage == schedule.stage
                && unit.schedule.feedback == schedule.feedback
                && (schedule.feedback.is_some() || unit.module == call.specification.module)
        });
        if let Some(unit) = joined {
            unit.calls.push(index);
        } else {
            units.push(Unit {
                module: call.specification.module,
                schedule,
                calls: vec![index],
            });
        }
        owners.push(units.len() - 1);
    }
    Ok((units, owners))
}

#[cfg(test)]
mod tests;

fn validate_feedback(call: &Call<'_, '_>, site: Site) -> ExecutionResult<()> {
    let Some(group) = call.specification.schedule.feedback else {
        return Ok(());
    };
    let valid = call.specification.schedule.stage.is_some()
        && !group.name.is_empty()
        && call
            .stage
            .context
            .epochs
            .iter()
            .all(|epoch| epoch.duration == 0.0)
        && matches!(call.specification.category, Category::Semantic(_));
    if !valid {
        return Err(fail(format!(
            "Feedback group {} requires a named stage and nonhistorical semantic work",
            group.name
        )));
    }
    if call.enabled
        && call
            .specification
            .strategy(site, &call.stage)?
            .iter()
            .any(|strategy| strategy.time != EffectTime::SpatialIteration)
    {
        return Err(fail(format!(
            "Feedback group {} requires a spatial strategy for {}",
            group.name, call.specification.contract.id
        )));
    }
    Ok(())
}

fn dependencies(
    call: &Call<'_, '_>,
    calls: &[Call<'_, '_>],
    local: &[usize],
) -> ExecutionResult<Vec<usize>> {
    let mut seen = BTreeSet::new();
    let owner = &call.specification.contract.id;
    for &name in call.specification.schedule.after {
        let applicable = calls.iter().enumerate().filter(|(_, call)| call.enabled);
        let exact = applicable.clone().find(|(_, call)| {
            call.stage
                .context
                .path
                .last()
                .is_some_and(|last| last == name)
        });
        let mut peers = local.iter().copied().filter(|&index| {
            calls[index].enabled && calls[index].specification.contract.id == name
        });
        let target = if let Some((index, _)) = exact {
            index
        } else if let (Some(index), None) = (peers.next(), peers.next()) {
            index
        } else {
            let mut named = applicable.filter(|(_, call)| call.specification.contract.id == name);
            match (named.next(), named.next()) {
                (Some((index, _)), None) => index,
                (None, _) => return Err(fail(format!("{owner} has missing dependency {name}"))),
                _ => {
                    return Err(fail(format!(
                        "{owner} has ambiguous dependency {name}; use its occurrence ID"
                    )))
                }
            }
        };
        if !seen.insert(target) {
            return Err(fail(format!("{owner} has duplicate dependency {name}")));
        }
    }
    Ok(seen.into_iter().collect())
}

fn order(
    indices: &[usize],
    dependencies: &[BTreeSet<usize>],
    priority: impl Fn(usize) -> i32,
    description: &str,
) -> ExecutionResult<Vec<usize>> {
    let mut pending: BTreeSet<_> = indices
        .iter()
        .map(|&index| (priority(index), index))
        .collect();
    let mut done = BTreeSet::new();
    let mut ordered = Vec::with_capacity(indices.len());
    while !pending.is_empty() {
        let next = pending
            .iter()
            .find(|(_, index)| dependencies[*index].is_subset(&done))
            .copied();
        let Some((priority, index)) = next else {
            return Err(fail(format!("Dependency cycle in {description}")));
        };
        pending.remove(&(priority, index));
        done.insert(index);
        ordered.push(index);
    }
    Ok(ordered)
}

fn emit<'a>(
    result: &mut Vec<Stage<'a>>,
    calls: &[Call<'a, '_>],
    indices: &[usize],
    schedule: Schedule,
) {
    let passes = schedule.feedback.map_or(1, |group| group.iterations.get());
    for pass in 1..=passes {
        for &index in indices {
            let stage = &calls[index].stage;
            let StageKind::Process(call) = stage.kind else {
                unreachable!()
            };
            let mut context = stage.context.clone();
            if let Some(group) = schedule.feedback {
                context.path.push(format!("feedback-{}/{pass}", group.name));
            }
            result.push(Stage {
                kind: StageKind::Process(call),
                context,
            });
        }
    }
}
