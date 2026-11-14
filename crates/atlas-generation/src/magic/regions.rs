//! Feature rules seed connected regions, then measure coverage from current accessible material.
mod readers;
use super::{
    channels::Channel,
    configuration::{Condition, Feature},
    sources::Environment,
    state::MagicField,
};
use crate::storage::{Band, Coverage};
use std::io;
pub type SystemRead<'a> = dyn Fn(&str, usize) -> io::Result<f64> + 'a;
pub struct Inputs<'a> {
    pub field: &'a MagicField,
    pub fields: &'a [MagicField],
    pub seed: i32,
    pub system_read: Option<&'a SystemRead<'a>>,
}
pub struct Rule<'a> {
    pub seeds: &'a [Vec<Condition>],
    pub retains: Option<&'a [Vec<Condition>]>,
}
struct Test<'a> {
    read: readers::Reader<'a>,
    min: f64,
    max: f64,
    values: Option<&'a [f64]>,
}
fn compile<'a>(
    env: &'a Environment<'_>,
    input: &'a Inputs<'a>,
    groups: &'a [Vec<Condition>],
) -> io::Result<Vec<Vec<Test<'a>>>> {
    groups
        .iter()
        .map(|group| {
            group
                .iter()
                .map(|test| {
                    Ok(Test {
                        read: readers::condition(env, input, test)?,
                        min: test.min.unwrap_or(f64::NEG_INFINITY),
                        max: test.max.unwrap_or(f64::INFINITY),
                        values: test.values.as_deref(),
                    })
                })
                .collect()
        })
        .collect()
}
fn matches(groups: &[Vec<Test<'_>>], cell: usize) -> io::Result<bool> {
    for group in groups {
        let mut included = true;
        for test in group {
            let value = (test.read)(cell)?;
            if !(value >= test.min
                && value <= test.max
                && test.values.is_none_or(|values| values.contains(&value)))
            {
                included = false;
                break;
            }
        }
        if included {
            return Ok(true);
        }
    }
    Ok(false)
}
pub fn grow(
    env: &Environment<'_>,
    input: &Inputs<'_>,
    rule: Rule<'_>,
    coverage: &mut Coverage,
) -> io::Result<Band<f64>> {
    let mut members = coverage.allocate(0.0);
    let seeds = compile(env, input, rule.seeds)?;
    let retains = compile(env, input, rule.retains.unwrap_or(rule.seeds))?;
    let mut queue = Vec::new();
    for cell in 0..env.mesh.len() {
        if matches(&seeds, cell)? {
            members.set(cell, 1.0)?;
            queue.push(cell);
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        for edge in 0..3 {
            let Some(next) = env.mesh.neighbor(cell, edge) else {
                continue;
            };
            if members.get(next)? > 0.0 || !matches(&retains, next)? {
                continue;
            }
            members.set(next, 1.0)?;
            queue.push(next);
        }
    }
    Ok(members)
}
pub fn rule_coverage(
    env: &Environment<'_>,
    input: &Inputs<'_>,
    rule: &Feature,
    members: &Band<f64>,
    allocator: &mut Coverage,
) -> io::Result<Band<f64>> {
    let mut coverage = allocator.allocate(0.0);
    let Some(range) = &rule.coverage else {
        for cell in 0..members.len() {
            coverage.set(cell, members.get(cell)?)?;
        }
        return Ok(coverage);
    };
    let test = Condition {
        field: range.field.clone(),
        min: None,
        max: None,
        values: None,
        salt: None,
        index: None,
    };
    let read = readers::condition(env, input, &test)?;
    for cell in 0..members.len() {
        if members.get(cell)? > 0.0 {
            coverage.set(
                cell,
                ((read(cell)? - range.floor) / (range.full - range.floor)).clamp(0.0, 1.0),
            )?;
        }
    }
    Ok(coverage)
}
pub fn independent_interaction(rule: &Feature, owner: &str) -> bool {
    let conditions: Vec<_> = rule
        .seeds
        .iter()
        .chain(rule.retains.iter().flatten())
        .flatten()
        .collect();
    conditions
        .iter()
        .any(|test| test.field.starts_with("system:"))
        && conditions.iter().all(|test| {
            test.field != format!("system:{owner}")
                && !Channel::ALL
                    .iter()
                    .any(|channel| channel.definition().name == test.field)
        })
}
pub fn cover_systems(
    env: &Environment<'_>,
    fields: &mut [MagicField],
    seed: i32,
    coverage: &mut Coverage,
) -> io::Result<()> {
    for index in 0..fields.len() {
        for cell in 0..env.mesh.len() {
            fields[index].system_coverage.set(cell, 0.0)?;
        }
        for rule_index in 0..fields[index].definition.features.len() {
            let field = &fields[index];
            let rule = &field.definition.features[rule_index];
            let active =
                field.definition.enabled || independent_interaction(rule, &field.definition.id);
            let (members, shares) = if active {
                let input = Inputs {
                    field,
                    fields,
                    seed,
                    system_read: None,
                };
                let members = grow(
                    env,
                    &input,
                    Rule {
                        seeds: &rule.seeds,
                        retains: rule.retains.as_deref(),
                    },
                    coverage,
                )?;
                let shares = rule_coverage(env, &input, rule, &members, coverage)?;
                (members, shares)
            } else {
                (coverage.allocate(0.0), coverage.allocate(0.0))
            };
            let field = &mut fields[index];
            for cell in 0..env.mesh.len() {
                field.system_coverage.set(
                    cell,
                    field.system_coverage.get(cell)?.max(shares.get(cell)?),
                )?;
            }
            field.features[rule_index].members = members;
            field.features[rule_index].coverage = shares;
        }
    }
    Ok(())
}
