use atlas_generation::storage::*;
use atlas_generation::{answers::*, execution::*};
use std::{cell::RefCell, io, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Key {
    Supply,
    Support,
    Loop,
    Unused,
}
fn responder(kind: ResponseKind<Vec<f64>, Key>) -> Responder<Vec<f64>, Key> {
    Responder {
        by: "supplied".into(),
        kind,
        queries: vec![],
    }
}

#[test]
fn composed_questions_resolve_actual_dependencies_and_partial_rule_breaks() {
    let mut book = QuestionBook::default();
    book.respond(
        Key::Support,
        responder(ResponseKind::Scale(Box::new(|_, _, _| Ok(2.0)))),
    )
    .unwrap();
    book.respond(
        Key::Support,
        responder(ResponseKind::Add(Box::new(|_, _, _| Ok(3.0)))),
    )
    .unwrap();
    book.respond(
        Key::Supply,
        responder(ResponseKind::Base(Box::new(|state, cell, _| {
            Ok(state[cell])
        }))),
    )
    .unwrap();
    book.respond(
        Key::Support,
        responder(ResponseKind::Base(Box::new(|_, _, answers| {
            Ok(answers.ask(Key::Supply)? * 2.0)
        }))),
    )
    .unwrap();
    book.respond(
        Key::Support,
        responder(ResponseKind::Break {
            share: Box::new(|_, _, _| Ok(0.25)),
            instead: Box::new(|_, _, _| Ok(20.0)),
        }),
    )
    .unwrap();
    assert_eq!(
        book.point(&vec![4.0], Key::Support, 0, &QueryValues::default())
            .unwrap(),
        21.5
    );
    assert!(book
        .respond(
            Key::Support,
            responder(ResponseKind::Base(Box::new(|_, _, _| Ok(0.0))))
        )
        .is_err());
}

struct SuppliedFile;
impl RandomAccessFile for SuppliedFile {
    fn read(&mut self, _: &mut [u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied answer bands fit in cache")
    }
    fn write(&mut self, _: &[u8], _: u64) -> io::Result<usize> {
        unreachable!("Supplied answer bands fit in cache")
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn close(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn derived_answer_bands_refresh_their_own_dependencies_and_keep_captured_values() {
    let provider = Query::new("needed", vec![], |state: &Vec<f64>, _| Ok(state.clone()));
    let unused = Query::new("unused", vec![], |_: &Vec<f64>, _| {
        Err::<(), _>(ExecutionError::Failed("Unrelated query ran".into()))
    });
    let read = provider.clone();
    let mut book = QuestionBook::default();
    book.respond(
        Key::Supply,
        Responder {
            by: "needed".into(),
            queries: vec![provider.dependency()],
            kind: ResponseKind::Base(Box::new(move |_, cell, answers| {
                Ok(answers.queries().get(&read)?[cell] * 2.0)
            })),
        },
    )
    .unwrap();
    book.respond(
        Key::Unused,
        Responder {
            by: "unused".into(),
            queries: vec![unused.dependency()],
            kind: ResponseKind::Base(Box::new(|_, _, _| Ok(0.0))),
        },
    )
    .unwrap();
    let cache = BlockCache::new(1024, BlockScratch::new(SuppliedFile));
    let coverage = Rc::new(RefCell::new(Coverage::samples(2, cache)));
    let query = Rc::new(book).query("supply", Key::Supply, coverage);
    let mut executor = Executor::new(vec![2.0, 4.0]);
    executor.select(&provider);
    executor.select(&unused);
    executor.select(&query);
    let captured = executor.query(&query).unwrap();
    let change = Command::new(
        "change",
        CommandKind::Work,
        vec![],
        |state: &mut Vec<f64>, _| {
            state[0] = 3.0;
            Ok(())
        },
    );
    executor.run(&change).unwrap();
    let current = executor.query(&query).unwrap();
    assert_eq!(captured.values().get(0).unwrap(), 4.0);
    assert_eq!(current.values().get(0).unwrap(), 6.0);
}

#[test]
fn cyclic_answers_fail_without_publishing_a_cached_value() {
    let mut book = QuestionBook::default();
    book.respond(
        Key::Loop,
        responder(ResponseKind::Base(Box::new(|_, _, answers| {
            answers.ask(Key::Loop)
        }))),
    )
    .unwrap();
    assert!(matches!(
        book.point(&vec![1.0], Key::Loop, 0, &QueryValues::default()),
        Err(ExecutionError::QueryCycle(_))
    ));
    assert!(matches!(
        book.point(&vec![1.0], Key::Loop, 0, &QueryValues::default()),
        Err(ExecutionError::QueryCycle(_))
    ));
}

#[test]
fn optional_unselected_queries_preserve_inherited_inputs_without_selecting_a_strategy() {
    let provider = Query::new("provider", vec![], |_: &i32, _| Ok(20));
    let inspect = provider.clone();
    let consumer = Query::new(
        "consumer",
        vec![provider.optional_dependency()],
        move |state, values| Ok(values.optional(&inspect)?.map_or(*state, |value| *value)),
    );
    let mut executor = Executor::new(7);
    executor.select(&consumer);
    assert_eq!(*executor.query(&consumer).unwrap(), 7);
    executor.bind(&provider, |_, _| Ok(30));
    assert_eq!(*executor.query(&consumer).unwrap(), 30);
}
