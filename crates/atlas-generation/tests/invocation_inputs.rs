use atlas_generation::execution::*;
use std::{
    cell::Cell,
    future::Future,
    pin::Pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

struct PhysicalInput {
    rainfall: f64,
}
fn input(value: f64) -> Rc<PhysicalInput> {
    Rc::new(PhysicalInput { rainfall: value })
}
fn poll<T>(future: Pin<&mut impl Future<Output = T>>) -> Poll<T> {
    future.poll(&mut Context::from_waker(Waker::noop()))
}
#[test]
fn dependencies_use_the_bound_input_and_cache_only_within_that_invocation() {
    let calls = Rc::new(Cell::new(0));
    let called = calls.clone();
    let rain = Query::new("rain", vec![], move |_: &(), context| {
        called.set(called.get() + 1);
        Ok(context.input::<PhysicalInput>()?.rainfall)
    });
    let value = rain.clone();
    let consumer = Command::with_inputs(
        "consumer",
        CommandKind::Work,
        vec![rain.dependency()],
        move |scope, expected: &f64| {
            assert_eq!(*scope.values().get(&value)?, *expected);
            assert_eq!(*scope.query(&value)?, *expected);
            assert_eq!(scope.values().input::<PhysicalInput>()?.rainfall, *expected);
            Ok(())
        },
    );
    let mut executor = Executor::new(());
    executor.select(&rain);
    executor
        .run_with_context(&consumer, &3.0, input(3.0))
        .unwrap();
    executor
        .run_with_context(&consumer, &7.0, input(7.0))
        .unwrap();
    assert_eq!(calls.get(), 2);
    assert!(matches!(
        executor.query(&rain),
        Err(ExecutionError::MissingInvocationInput(_))
    ));
    let original = rain.clone();
    let derived = Query::new("derived", vec![rain.dependency()], move |_: &(), reader| {
        Ok((
            reader.input::<PhysicalInput>()?.rainfall,
            *reader.get(&original)?,
        ))
    });
    executor.select_with_input(&derived, |value: &PhysicalInput| PhysicalInput {
        rainfall: value.rainfall * 2.0,
    });
    assert_eq!(
        *executor.query_with_context(&derived, input(4.0)).unwrap(),
        (8.0, 4.0)
    );
    executor.select_with_input(&derived, |_: &PhysicalInput| PhysicalInput {
        rainfall: 99.0,
    });
    assert_eq!(
        *executor.query_with_context(&derived, input(5.0)).unwrap(),
        (10.0, 5.0)
    );
}
#[test]
fn nested_inputs_restore_the_parent_even_after_failure() {
    let rain = Query::new("rain", vec![], |_: &(), context| {
        Ok(context.input::<PhysicalInput>()?.rainfall)
    });
    let reading = rain.clone();
    let child = Command::new(
        "child",
        CommandKind::Event,
        vec![rain.dependency()],
        move |_, values| {
            assert_eq!(*values.get(&reading)?, 9.0);
            Err(ExecutionError::Failed("supplied failure".into()))
        },
    );
    let reading = rain.clone();
    let parent = Command::with_inputs(
        "parent",
        CommandKind::Work,
        vec![],
        move |scope: &mut CommandContext<'_, ()>, _: &()| {
            assert_eq!(*scope.query(&reading)?, 2.0);
            assert!(scope.run_with_context(&child, &(), input(9.0)).is_err());
            assert_eq!(*scope.query(&reading)?, 2.0);
            assert_eq!(scope.values().input::<PhysicalInput>()?.rainfall, 2.0);
            Ok(())
        },
    );
    let mut executor = Executor::new(());
    executor.select(&rain);
    executor.run_with_context(&parent, &(), input(2.0)).unwrap();
    assert!(executor.query(&rain).is_err());
    assert_eq!(
        *executor.query_with_context(&rain, input(5.0)).unwrap(),
        5.0
    );
    assert!(executor.query_with_context(&rain, Rc::new(5u32)).is_err());
}
#[test]
fn dropping_a_suspended_command_releases_its_context() {
    let rain = Query::new("rain", vec![], |_: &u32, context| {
        Ok(context.input::<PhysicalInput>()?.rainfall)
    });
    let reading = rain.clone();
    let command = Command::async_with_inputs(
        "suspend",
        CommandKind::Work,
        vec![rain.dependency()],
        move |scope, _: &()| {
            let reading = reading.clone();
            Box::pin(async move {
                assert_eq!(*scope.values().get(&reading)?, 4.0);
                *scope.state_mut() = 1;
                std::future::pending::<()>().await;
                Ok(())
            })
        },
    );
    let mut executor = Executor::new(0);
    executor.select(&rain);
    let context = input(4.0);
    let weak = Rc::downgrade(&context);
    let mut future = Box::pin(executor.run_async_with_context(&command, &(), context));
    assert_eq!(poll(future.as_mut()), Poll::Pending);
    drop(future);
    assert!(weak.upgrade().is_none());
    assert_eq!(*executor.state(), 1);
    assert!(executor.query(&rain).is_err());
}
