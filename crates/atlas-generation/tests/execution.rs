use atlas_generation::composition::*;
use atlas_generation::execution::*;
use std::{cell::Cell, rc::Rc};
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll, Waker},
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

fn asynchronous_add() -> Command<i32, i32> {
    Command::async_with_inputs(
        "async-field-write",
        CommandKind::Work,
        vec![],
        |context, amount: &i32| {
            Box::pin(async move {
                *context.state_mut() += *amount;
                Ok(())
            })
        },
    )
}
struct ProjectionState {
    field: i32,
    records: i32,
}

#[test]
fn projected_commands_and_map_queries_share_live_state_and_invalidation() {
    let projection = Projection::new(
        |map: &ProjectionState| &map.field,
        |map: &mut ProjectionState| &mut map.field,
    );
    let records = Query::new(
        "records",
        vec![],
        |map: &ProjectionState, _| Ok(map.records),
    );
    let source = records.clone();
    let field_query = Query::new("field-with-records", vec![], move |field: &i32, reader| {
        Ok(*field + *reader.root_query(&source)?)
    });
    let projected_query = field_query.projected(&projection);
    assert_eq!(field_query.identity(), projected_query.identity());
    let dependency = field_query.clone();
    let write = Command::with_inputs(
        "field-write",
        CommandKind::Work,
        vec![field_query.dependency()],
        move |context, amount: &i32| {
            let before = *context.values().get(&dependency)?;
            *context.state_mut() = before + amount;
            Ok(())
        },
    );
    let projected_write = write.projected(&projection);
    assert_eq!(write.identity(), projected_write.identity());
    let mut executor = Executor::new(ProjectionState {
        field: 2,
        records: 3,
    });
    executor.select(&records);
    executor.selection_in(&projection).select(&field_query);
    assert_eq!(*executor.query(&projected_query).unwrap(), 5);
    executor.run_with(&projected_write, &1).unwrap();
    assert_eq!(executor.state().field, 6);
    let change_records = Command::new(
        "records-write",
        CommandKind::Work,
        vec![],
        |map: &mut ProjectionState, _| {
            map.records = 9;
            Ok(())
        },
    );
    executor.run(&change_records).unwrap();
    assert_eq!(*executor.query(&projected_query).unwrap(), 15);
    check_projection_effects(&mut executor, &projection, &projected_query);
}
fn check_projection_effects(
    executor: &mut Executor<ProjectionState>,
    projection: &Projection<ProjectionState, i32>,
    projected_query: &Query<ProjectionState, i32>,
) {
    let failed = Command::new(
        "failed-field-write",
        CommandKind::Work,
        vec![],
        |field: &mut i32, _| {
            *field = 0;
            Err(ExecutionError::Failed("supplied failure".into()))
        },
    )
    .projected(projection);
    assert!(executor.run(&failed).is_err());
    assert_eq!(*executor.query(projected_query).unwrap(), 9);
    let asynchronous = asynchronous_add().projected(projection);
    let mut future = Box::pin(executor.run_async_with(&asynchronous, &4));
    let mut context = Context::from_waker(Waker::noop());
    assert!(matches!(
        future.as_mut().poll(&mut context),
        Poll::Ready(Ok(()))
    ));
    drop(future);
    assert_eq!(*executor.query(projected_query).unwrap(), 13);
    let record = Command::new(
        "record-current-field",
        CommandKind::Event,
        vec![],
        |map: &mut ProjectionState, _| {
            map.records = map.field;
            Ok(())
        },
    );
    let hook: Command<i32> = Command::with_inputs(
        "field-owner-hook",
        CommandKind::Event,
        vec![],
        move |context, _: &()| context.root_run(&record, &()),
    );
    executor.run(&hook.projected(projection)).unwrap();
    assert_eq!(*executor.query(projected_query).unwrap(), 8);
}

#[test]
fn queries_are_selected_cached_and_refreshed_after_failed_commands() {
    let calls = Rc::new(Cell::new(0));
    let count = calls.clone();
    let query = Query::new("value", vec![], move |state: &i32, _| {
        count.set(count.get() + 1);
        Ok(*state * 2)
    });
    let mut runtime = Executor::new(3);
    assert!(matches!(
        runtime.query(&query),
        Err(ExecutionError::Unselected(_))
    ));
    runtime.select(&query);
    assert_eq!(*runtime.query(&query).unwrap(), 6);
    assert_eq!(*runtime.query(&query).unwrap(), 6);
    assert_eq!(calls.get(), 1);
    let change = Command::new(
        "partial write",
        CommandKind::Work,
        vec![],
        |state: &mut i32, _| {
            *state = 4;
            Err(ExecutionError::Failed("partial".into()))
        },
    );
    assert!(runtime.run(&change).is_err());
    assert_eq!(*runtime.query(&query).unwrap(), 8);
    assert_eq!(calls.get(), 2);
}

#[test]
fn selected_strategies_preserve_dependencies_and_helpers_compose_reads() {
    let base = Query::new("base", vec![], |state: &i32, _| Ok(*state));
    let base_read = base.clone();
    let derived = Query::new("derived", vec![base.dependency()], move |_, values| {
        Ok(*values.get(&base_read)? + 1)
    });
    let mut runtime = Executor::new(5);
    runtime.select(&base);
    runtime.select(&derived);
    assert_eq!(*runtime.query(&derived).unwrap(), 6);
    runtime.bind(&derived, |_, _| Ok(14));
    runtime.select(&derived);
    assert_eq!(*runtime.query(&derived).unwrap(), 14);
    let hidden = base.clone();
    let helper = Query::new("helper composition", vec![], move |_, values| {
        values.get(&hidden).map(|v| *v)
    });
    runtime.select(&helper);
    assert_eq!(*runtime.query(&helper).unwrap(), 5);
}

#[test]
fn batches_invalidate_once_and_commands_observe_sequential_state_changes() {
    let add = Command::new("add", CommandKind::Work, vec![], |state: &mut i32, _| {
        *state += 1;
        Ok(())
    });
    let mut runtime = Executor::new(0);
    runtime
        .batch(|runtime| {
            runtime.run(&add)?;
            runtime.run(&add)
        })
        .unwrap();
    assert_eq!(runtime.revision(), 1);
    assert_eq!(*runtime.state(), 2);
    runtime.run(&add).unwrap();
    assert_eq!(runtime.revision(), 2);
}

#[test]
fn selected_feature_steps_alone_define_registration_and_execution() {
    let add = Rc::new(Command::new(
        "add",
        CommandKind::Work,
        vec![],
        |state: &mut i32, _| {
            *state += 1;
            Ok(())
        },
    ));
    let multiply = Rc::new(Command::new(
        "multiply",
        CommandKind::Work,
        vec![],
        |state: &mut i32, _| {
            *state *= 3;
            Ok(())
        },
    ));
    let sequence = CompiledSequence::from_features([
        Feature {
            id: "first".into(),
            steps: vec![Step::command("add", 1, add.clone())],
        },
        Feature {
            id: "second".into(),
            steps: vec![Step::command("multiply", 2, multiply)],
        },
    ])
    .unwrap();
    let mut executor = Executor::new(1);
    sequence.execute(&mut executor).unwrap();
    assert_eq!(*executor.state(), 6);
    assert_eq!(sequence.feature_at(0), Some("first"));
    assert_eq!(sequence.feature_at(1), Some("second"));
    assert_eq!(
        sequence.registered().collect::<Vec<_>>(),
        ["add", "multiply"]
    );
    let alias = Rc::new(Command::new(
        "add",
        CommandKind::Work,
        vec![],
        |_: &mut i32, _| Ok(()),
    ));
    assert!(CompiledSequence::from_features([Feature {
        id: "ambiguous".into(),
        steps: vec![Step::command("one", 0, add), Step::command("two", 0, alias)]
    }])
    .is_err());
}

fn poll<T>(future: Pin<&mut impl Future<Output = T>>) -> Poll<T> {
    future.poll(&mut Context::from_waker(Waker::noop()))
}

#[test]
fn invocation_parameters_and_nested_owner_commands_share_queries_and_bound_context() {
    let current = Query::new("current", vec![], |state: &i32, _| Ok(*state));
    let dependency = current.clone();
    let write = Command::with_inputs(
        "owner.add",
        CommandKind::Work,
        vec![current.dependency()],
        move |context: &mut CommandContext<'_, i32>, amount: &i32| {
            assert_eq!(context.values().invocation().step_salt, 17);
            *context.state_mut() = *context.values().get(&dependency)? + amount;
            Ok(())
        },
    );
    let reading = current.clone();
    let outer = Command::with_inputs(
        "process",
        CommandKind::Work,
        vec![],
        move |context: &mut CommandContext<'_, i32>, amounts: &[i32; 2]| {
            let before = *context.query(&reading)?;
            context.run(&write, &amounts[0])?;
            assert_eq!(*context.query(&reading)?, before + amounts[0]);
            context.run(&write, &amounts[1])
        },
    );
    let mut executor = Executor::new(3);
    executor.select(&current);
    executor.set_invocation(atlas_generation::bindings::Invocation {
        step_salt: 17,
        ..Default::default()
    });
    executor.run_with(&outer, &[2, 4]).unwrap();
    assert_eq!(*executor.query(&current).unwrap(), 9);
    executor.run_with(&outer, &[1, 3]).unwrap();
    assert_eq!(*executor.query(&current).unwrap(), 13);
}
#[test]
fn feature_steps_bind_inputs_without_forking_operation_identity() {
    let write = Command::with_inputs(
        "add",
        CommandKind::Work,
        vec![],
        |context: &mut CommandContext<'_, i32>, amount: &i32| {
            *context.state_mut() += amount;
            Ok(())
        },
    );
    let sequence = CompiledSequence::from_features([Feature {
        id: "supplied".into(),
        steps: vec![
            Step::command_with("first", 3, &write, 2),
            Step::command_with("second", 4, &write, 7),
        ],
    }])
    .unwrap();
    let mut executor = Executor::new(0);
    sequence.execute(&mut executor).unwrap();
    assert_eq!(*executor.state(), 9);
    assert_eq!(sequence.registered().collect::<Vec<_>>(), ["add"]);
    let asynchronous = Command::async_with_inputs(
        "await add",
        CommandKind::Work,
        vec![],
        |context: &mut CommandContext<'_, i32>, amount: &i32| {
            Box::pin(async move {
                std::future::ready(()).await;
                *context.state_mut() += amount;
                Ok(())
            })
        },
    );
    let sequence = CompiledSequence::from_features([Feature {
        id: "supplied".into(),
        steps: vec![Step::command_with("third", 5, &asynchronous, 4)],
    }])
    .unwrap();
    assert_eq!(
        poll(Box::pin(sequence.execute_async(&mut executor)).as_mut()),
        Poll::Ready(Ok(()))
    );
    assert_eq!(*executor.state(), 13);
}

#[test]
fn nested_async_cancellation_and_errors_leave_current_queries_invalidated() {
    let current = Query::new("current", vec![], |state: &i32, _| Ok(*state));
    let child = Rc::new(Command::async_with_inputs(
        "owner.suspend",
        CommandKind::Work,
        vec![],
        |context: &mut CommandContext<'_, i32>, amount: &i32| {
            Box::pin(async move {
                *context.state_mut() += amount;
                std::future::pending::<()>().await;
                Ok(())
            })
        },
    ));
    let outer = Command::async_with_inputs(
        "process.suspend",
        CommandKind::Work,
        vec![],
        move |context, amount| {
            let child = child.clone();
            Box::pin(async move { context.run_async(&child, amount).await })
        },
    );
    let mut executor = Executor::new(3);
    executor.select(&current);
    assert_eq!(*executor.query(&current).unwrap(), 3);
    let mut pending = Box::pin(executor.run_async_with(&outer, &4));
    assert_eq!(poll(pending.as_mut()), Poll::Pending);
    drop(pending);
    assert_eq!(*executor.query(&current).unwrap(), 7);
    let failure = Command::with_inputs(
        "owner.fail",
        CommandKind::Work,
        vec![],
        |context: &mut CommandContext<'_, i32>, amount: &i32| {
            *context.state_mut() += amount;
            Err(ExecutionError::Failed("partial owner write".into()))
        },
    );
    let child_query = current.clone();
    let recover = Command::with_inputs(
        "process.observe failure",
        CommandKind::Work,
        vec![],
        move |context: &mut CommandContext<'_, i32>, amount: &i32| {
            assert!(context.run(&failure, amount).is_err());
            assert_eq!(*context.query(&child_query)?, *context.state());
            Ok(())
        },
    );
    executor.run_with(&recover, &2).unwrap();
    assert_eq!(*executor.query(&current).unwrap(), 9);
}

#[test]
fn asynchronous_commands_resolve_dependencies_and_invalidate_after_completion() {
    let query = Query::new("current", vec![], |state: &i32, _| Ok(*state));
    let dependency = query.clone();
    let command = Command::asynchronous(
        "await work",
        CommandKind::Work,
        vec![query.dependency()],
        move |state, values| {
            let dependency = dependency.clone();
            Box::pin(async move {
                *state = *values.get(&dependency)? + 1;
                std::future::ready(()).await;
                Ok(())
            })
        },
    );
    let mut executor = Executor::new(2);
    executor.select(&query);
    assert_eq!(
        executor.run(&command),
        Err(ExecutionError::AsyncDispatchRequired("await work".into()))
    );
    assert_eq!(executor.revision(), 0);
    assert_eq!(
        poll(Box::pin(executor.run_async(&command)).as_mut()),
        Poll::Ready(Ok(()))
    );
    assert_eq!(*executor.query(&query).unwrap(), 3);
}

#[test]
fn suspended_and_failed_commands_invalidate_partially_changed_state() {
    let query = Query::new("current", vec![], |state: &i32, _| Ok(*state));
    let mut executor = Executor::new(3);
    executor.select(&query);
    assert_eq!(*executor.query(&query).unwrap(), 3);
    let suspended = Command::asynchronous(
        "suspend",
        CommandKind::Work,
        vec![],
        |state: &mut i32, _| {
            Box::pin(async move {
                *state = 5;
                std::future::pending::<()>().await;
                Ok(())
            })
        },
    );
    let mut invocation = Box::pin(executor.run_async(&suspended));
    assert_eq!(poll(invocation.as_mut()), Poll::Pending);
    drop(invocation);
    assert_eq!(executor.revision(), 1);
    assert_eq!(*executor.query(&query).unwrap(), 5);
    let failure = Command::asynchronous(
        "failed work",
        CommandKind::Work,
        vec![],
        |state: &mut i32, _| {
            Box::pin(async move {
                *state = 7;
                Err(ExecutionError::Failed("supplied failure".into()))
            })
        },
    );
    assert!(matches!(
        poll(Box::pin(executor.run_async(&failure)).as_mut()),
        Poll::Ready(Err(_))
    ));
    assert_eq!(*executor.query(&query).unwrap(), 7);
}

#[test]
fn feature_sequences_await_commands_before_the_next_operation() {
    let command = Rc::new(Command::asynchronous(
        "increment",
        CommandKind::Work,
        vec![],
        |state: &mut i32, _| {
            Box::pin(async move {
                std::future::ready(()).await;
                *state += 1;
                Ok(())
            })
        },
    ));
    let sequence = CompiledSequence::from_features([Feature {
        id: "supplied".into(),
        steps: vec![
            Step::command("first", 1, command.clone()),
            Step::command("second", 2, command),
        ],
    }])
    .unwrap();
    let mut executor = Executor::new(0);
    assert_eq!(
        poll(Box::pin(sequence.execute_async(&mut executor)).as_mut()),
        Poll::Ready(Ok(()))
    );
    assert_eq!(*executor.state(), 2);
}

#[test]
fn selected_queries_use_their_own_seed_and_commands_receive_bound_work() {
    use atlas_generation::bindings::{physical_seeds, DurationBinding, Invocation};
    let query = Query::new("own pattern", vec![], |_: &Vec<i32>, context| {
        assert_eq!(context.invocation().work().unwrap(), 0.0);
        Ok(context.invocation().seeds().epoch_stable_seed)
    });
    let read = query.clone();
    let command = Rc::new(Command::new(
        "work",
        CommandKind::Elapsed,
        vec![query.dependency()],
        move |state: &mut Vec<i32>, values| {
            let context = values.invocation();
            assert_eq!(
                context
                    .duration(DurationBinding::EpochFraction(0.5))
                    .unwrap(),
                12.0
            );
            assert_eq!(context.work().unwrap(), 3.0);
            state.push(*values.get(&read)?);
            state.push(context.seeds().seed);
            Ok(())
        },
    ));
    let sequence = CompiledSequence::from_features([Feature {
        id: "supplied".into(),
        steps: vec![
            Step::command("first consumer", 11, command.clone()),
            Step::query("provider", 29, query),
            Step::command("second consumer", 17, command),
        ],
    }])
    .unwrap();
    let mut executor = Executor::new(Vec::new());
    executor.set_invocation(Invocation {
        world_seed: 73,
        epoch_index: 2,
        epoch_duration: Some(24.0),
        exposure: 3.0,
        ..Invocation::default()
    });
    sequence.execute(&mut executor).unwrap();
    assert_eq!(
        executor.state(),
        &vec![
            73 ^ 29,
            physical_seeds(73, 11, 2).seed,
            73 ^ 29,
            physical_seeds(73, 17, 2).seed
        ]
    );
}
