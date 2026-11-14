//! Each material answers the shared question through its own physical medium.
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{ExecutionError, ExecutionResult},
    field::{shared::Scalar as S, Field},
};
pub fn respond(
    book: &mut QuestionBook<Field, &'static str>,
    charged_ice_erosion: f64,
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
            by: "fire".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(
                move |f, i, _| Ok(1.0 + read(f, S::Quickening, i)?),
            )),
        },
    )?;
    book.respond(
        "heat",
        Responder {
            by: "fire".into(),
            queries: vec![],
            kind: ResponseKind::Add(Box::new(move |f, i, _| {
                Ok(read(f, S::ExternalHeatForcing, i)?.max(0.0) / 1000.0)
            })),
        },
    )?;
    book.respond(
        "warmth",
        Responder {
            by: "aurora".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(move |f, i, _| {
                Ok((1.0 - read(f, S::Stillness, i)?).max(0.0))
            })),
        },
    )?;
    book.respond(
        "iceBite",
        Responder {
            by: "aurora".into(),
            queries: vec![],
            kind: ResponseKind::Scale(Box::new(move |f, i, _| {
                Ok(1.0 + charged_ice_erosion / 1000.0 * read(f, S::IceCharge, i)?)
            })),
        },
    )?;
    book.respond(
        "wetness",
        Responder {
            by: "greenwood".into(),
            queries: vec![],
            kind: ResponseKind::Add(Box::new(move |f, i, _| Ok(read(f, S::Verdure, i)? * 0.5))),
        },
    )?;
    book.respond(
        "wetness",
        Responder {
            by: "salt".into(),
            queries: vec![],
            kind: ResponseKind::Add(Box::new(move |f, i, _| Ok(read(f, S::Salting, i)? * 0.5))),
        },
    )
}
