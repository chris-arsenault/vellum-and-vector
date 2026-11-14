//! World and elapsed human ecology use the same lifecycle on retained owner state.
use crate::{
    ecology::{
        carbon,
        forcing::Inputs,
        history::{self, Summary, Transition},
        lifecycle::{self, Advance, Authority},
    },
    execution::{Command, CommandKind, QueryDependency},
    field::{
        shared::{CellCode, Scalar},
        Field,
    },
};
use std::cell::RefCell;

pub struct Establish<'a> {
    pub seed: i32,
    pub inherited: bool,
    pub authority: &'a Authority,
}
pub struct Elapsed<'a> {
    pub time: Advance,
    pub reset_migration: bool,
    pub forcing: &'a Inputs,
    pub authority: &'a Authority,
    pub transitions: RefCell<Vec<Transition>>,
}
pub struct Burial<'a> {
    pub seed: i32,
    pub years: f64,
    pub inherited: bool,
    pub authority: &'a Authority,
    pub summary: RefCell<Option<Summary>>,
}
pub fn initialize<'a>() -> Command<Field, Establish<'a>> {
    Command::with_inputs(
        "atlas.ecology-initialize",
        CommandKind::Initialize,
        vec![],
        |scope, input: &Establish<'_>| {
            scope.state_mut().with_ecology(|map, initialized, _| {
                lifecycle::initialize(
                    map,
                    initialized,
                    input.seed,
                    input.inherited,
                    &|map, cell| input.authority.restore(map, cell),
                )
            })?;
            Ok(())
        },
    )
}
pub fn settle<'a>(dependencies: Vec<QueryDependency<Field>>) -> Command<Field, Establish<'a>> {
    Command::with_inputs(
        "atlas.ecology-settle",
        CommandKind::Event,
        dependencies,
        |scope, input: &Establish<'_>| {
            scope.state_mut().with_ecology(|map, initialized, _| {
                lifecycle::present(map, initialized, input.seed, &|map, cell| {
                    input.authority.restore(map, cell)
                })
            })?;
            Ok(())
        },
    )
}
pub fn advance<'a>(
    name: &str,
    dependencies: Vec<QueryDependency<Field>>,
) -> Command<Field, Elapsed<'a>> {
    Command::with_inputs(
        name,
        CommandKind::Elapsed,
        vec![],
        move |scope, input: &Elapsed<'_>| {
            if input.time.inherited && !input.time.new_human_time {
                return Ok(());
            }
            scope.run(&prepare(), input)?;
            scope.run(&evolve(dependencies.clone()), input)
        },
    )
}
fn prepare<'a>() -> Command<Field, Elapsed<'a>> {
    Command::with_inputs(
        "ecology.prepare-elapsed",
        CommandKind::Event,
        vec![],
        |scope, input: &Elapsed<'_>| {
            scope.state_mut().with_ecology(|map, _, _| {
                for cell in 0..map.mesh.len() {
                    if input.reset_migration && !input.time.inherited {
                        map.set(Scalar::MigrationFlux, cell, 0.0)?;
                    }
                    input.authority.restore(map, cell)?;
                }
                Ok(())
            })?;
            Ok(())
        },
    )
}
fn evolve<'a>(dependencies: Vec<QueryDependency<Field>>) -> Command<Field, Elapsed<'a>> {
    Command::with_inputs(
        "ecology.develop-retained-communities",
        CommandKind::Elapsed,
        dependencies,
        |scope, input: &Elapsed<'_>| {
            if input.time.inherited && !input.time.new_human_time {
                return Ok(());
            }
            scope
                .state_mut()
                .with_ecology(|map, initialized, coverage| {
                    let before = coverage.copy_band(map.fields.code_mut(CellCode::BiomeCodes))?;
                    lifecycle::advance(
                        map,
                        initialized,
                        &input.time,
                        &|cell| input.forcing.at(cell),
                        &|map, cell| input.authority.restore(map, cell),
                        coverage,
                    )?;
                    *input.transitions.borrow_mut() =
                        history::transitions(map, &before.read_only())?;
                    Ok(())
                })?;
            Ok(())
        },
    )
}
pub fn burial<'a>(dependencies: Vec<QueryDependency<Field>>) -> Command<Field, Burial<'a>> {
    let age: Command<Field, f64> = Command::with_inputs(
        "ecology.buried-carbon",
        CommandKind::Elapsed,
        vec![],
        |scope, years: &f64| {
            scope
                .state_mut()
                .with_ecology(|map, _, _| carbon::evolve(map, *years))?;
            Ok(())
        },
    );
    Command::with_inputs(
        "atlas.ecology-burial",
        CommandKind::Elapsed,
        vec![],
        move |scope, input: &Burial<'_>| {
            scope.run(&age, &if input.inherited { 0.0 } else { input.years })?;
            scope.run(
                &settle(dependencies.clone()),
                &Establish {
                    seed: input.seed,
                    inherited: input.inherited,
                    authority: input.authority,
                },
            )?;
            scope.state_mut().with_ecology(|map, _, _| {
                *input.summary.borrow_mut() = Some(history::summarize(map)?);
                Ok(())
            })?;
            Ok(())
        },
    )
}
