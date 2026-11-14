//! Explicit operation contracts, without a configured simulation or generated world.
use super::{tests::seed, Field};
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{Executor, Query},
    processes::{
        creep,
        runner::{self, PhysicalContext, StageProcess},
    },
    rock::ground::observers::GroundObservers,
};
use std::{cell::RefCell, rc::Rc};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

#[derive(Debug, PartialEq)]
enum Event {
    Read,
    Submit(&'static str, usize, f64),
}
type Trace = Rc<RefCell<Vec<Event>>>;

fn participant(
    id: &'static str,
    count: f64,
    input: Query<Field, ()>,
    trace: Trace,
) -> StageProcess {
    StageProcess::new(
        id,
        vec![input.dependency()],
        move |_| count,
        move |_, work, values| {
            values
                .get(&input)
                .map_err(|error| std::io::Error::other(format!("{error:?}")))?;
            trace
                .borrow_mut()
                .push(Event::Submit(id, work.substep, work.span));
            Ok(())
        },
    )
}

fn execute(together: bool) -> Vec<Event> {
    let trace: Trace = Rc::default();
    let reads = trace.clone();
    let input = Query::new("test.observed-input", vec![], move |_: &Field, context| {
        let input = context.input::<PhysicalContext>()?;
        assert_eq!(input.hydrology_strength, 1000.0);
        assert_eq!(input.span, 6.0);
        reads.borrow_mut().push(Event::Read);
        Ok(())
    });
    let mut book = QuestionBook::default();
    book.respond(
        0,
        Responder {
            by: "supplied roots".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|_, _, _| Ok(0.0))),
        },
    )
    .unwrap();
    let roots = Field::question(Rc::new(book), "rootHold", 0);
    let processes = vec![
        participant("first", 2.0, input.clone(), trace.clone()),
        participant("second", 3.0, input.clone(), trace.clone()),
    ];
    let command = if together {
        runner::together("joint", processes, roots.clone())
    } else {
        runner::by("ordered", processes, roots.clone())
    };
    let mut executor = Executor::new(seed().finish(Box::<GroundObservers>::default()).unwrap());
    executor.select(&input);
    executor.select(&roots);
    executor
        .run_with(
            &command,
            &PhysicalContext {
                span: 6.0,
                hydrology_strength: 1000.0,
                ..Default::default()
            },
        )
        .unwrap();
    let events = std::mem::take(&mut *trace.borrow_mut());
    events
}

#[test]
fn simultaneous_inputs_resolve_once_before_each_finest_substep() {
    assert_eq!(
        execute(true),
        vec![
            Event::Read,
            Event::Submit("first", 0, 2.0),
            Event::Submit("second", 0, 2.0),
            Event::Read,
            Event::Submit("first", 1, 2.0),
            Event::Submit("second", 1, 2.0),
            Event::Read,
            Event::Submit("first", 2, 2.0),
            Event::Submit("second", 2, 2.0),
        ]
    );
}
#[test]
fn ordered_processes_finish_their_own_substeps_before_the_next() {
    assert_eq!(
        execute(false),
        vec![
            Event::Read,
            Event::Submit("first", 0, 3.0),
            Event::Read,
            Event::Submit("first", 1, 3.0),
            Event::Read,
            Event::Submit("second", 0, 2.0),
            Event::Read,
            Event::Submit("second", 1, 2.0),
            Event::Read,
            Event::Submit("second", 2, 2.0),
        ]
    );
}
#[test]
fn levelling_allows_for_every_face_receiving_at_the_same_time() {
    assert_eq!(creep::levelling(8.0, 20.0, 3, 3), 40.0);
    assert_eq!(creep::levelling(8.0, 20.0, 3, 7), 20.0);
    assert_eq!(creep::levelling(-2.0, 20.0, 3, 3), 0.0);
}

#[test]
fn metamorphism_keeps_surface_beds_and_heats_buried_material_with_its_history() {
    use crate::rock::{cargo::MaterialCargo, catalogue, columns::Column, material::MaterialLayer};
    let mut seed = seed();
    seed.ground.completed_epochs = 12.0;
    let cargo = MaterialCargo::from_entries([(1, catalogue::SANDSTONE as i32, 4.0)]);
    for (slot, material) in [
        catalogue::material(catalogue::SHALE, 100.0, 2.0),
        MaterialLayer {
            cargo: Some(cargo.clone()),
            ..catalogue::material(catalogue::SANDSTONE, 200.0, 3.0)
        },
        catalogue::material(catalogue::SHALE, 500.0, 4.0),
    ]
    .iter()
    .enumerate()
    {
        seed.ground
            .columns
            .set_layer(0, Column::Land, slot, material)
            .unwrap();
    }
    seed.ground
        .columns
        .set_layer(
            0,
            Column::Loose,
            0,
            &catalogue::material(catalogue::ALLUVIUM, 50.0, 8.0),
        )
        .unwrap();
    let field = seed.finish(Box::<GroundObservers>::default()).unwrap();
    field
        .ground
        .borrow_mut()
        .metamorphose_below(0, 150.0)
        .unwrap();
    let ground = field.ground();
    let top = ground.columns().read_layer(0, Column::Land, 0).unwrap();
    assert_eq!((top.kind, top.altered), (catalogue::SHALE, 2.0));
    let buried = ground.columns().read_layer(0, Column::Land, 1).unwrap();
    assert_eq!(catalogue::kind_of_code(buried.kind).id, "quartzite");
    assert_eq!(
        (
            buried.depth,
            buried.formed_min,
            buried.formed_max,
            buried.altered
        ),
        (200.0, 3.0, 3.0, 12.0)
    );
    assert_eq!(buried.cargo.as_ref(), Some(&cargo));
    let basement = ground.columns().read_layer(0, Column::Land, 2).unwrap();
    assert_eq!(catalogue::kind_of_code(basement.kind).id, "slate");
}
