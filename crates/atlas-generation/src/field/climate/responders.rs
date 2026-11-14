use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{ExecutionError, ExecutionResult, QueryDependency},
    field::{shared::Scalar, Field},
};
pub fn respond(
    book: &mut QuestionBook<Field, &'static str>,
    atmosphere: QueryDependency<Field>,
    currents: QueryDependency<Field>,
    reference_runoff: f64,
) -> ExecutionResult<()> {
    let read = |field: &Field, name, cell| {
        field
            .shared()
            .scalar(name)
            .get(cell)
            .map_err(|e| ExecutionError::Failed(e.to_string()))
    };
    book.respond(
        "warmth",
        Responder {
            by: "climate".into(),
            queries: vec![atmosphere.clone()],
            kind: ResponseKind::Base(Box::new(move |field, cell, _| {
                Ok((read(field, Scalar::Temperature, cell)? - 300.0).max(0.0) / 200.0)
            })),
        },
    )?;
    book.respond(
        "frost",
        Responder {
            by: "climate".into(),
            queries: vec![atmosphere],
            kind: ResponseKind::Base(Box::new(move |field, cell, _| {
                Ok(
                    (1.0 - (read(field, Scalar::Temperature, cell)? - 300.0).abs() / 100.0)
                        .clamp(0.0, 1.0)
                        * (read(field, Scalar::Rainfall, cell)? / reference_runoff).clamp(0.0, 1.0),
                )
            })),
        },
    )?;
    book.respond(
        "waveEnergy",
        Responder {
            by: "sea".into(),
            queries: vec![currents],
            kind: ResponseKind::Base(Box::new(move |field, cell, _| {
                read(field, Scalar::WaveExposure, cell)
            })),
        },
    )
}
