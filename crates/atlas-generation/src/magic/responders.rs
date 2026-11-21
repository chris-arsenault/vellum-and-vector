//! Each material answers the shared question through its own physical medium.
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{ExecutionError, ExecutionResult},
    field::{shared::Scalar as S, Field},
};
/// Where a medium runs strong, people cannot stay: a Fire core's quickening burns hearths and
/// bodies alike, and deep aurora stillness stops the living. Above this strength a medium
/// takes ground from people, and all of it once the medium is full.
const REFUSES: f64 = 0.6;
/// The share of a cell a medium of `strength` (0 to 1) leaves for people to live on.
pub fn left_to_the_living(strength: f64) -> f64 {
    1.0 - ((strength - REFUSES) / (1.0 - REFUSES)).clamp(0.0, 1.0)
}
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
    for (system, medium) in [("fire", S::Quickening), ("aurora", S::Stillness)] {
        book.respond(
            "livable",
            Responder {
                by: system.into(),
                queries: vec![],
                kind: ResponseKind::Scale(Box::new(move |f, i, _| {
                    Ok(left_to_the_living(read(f, medium, i)?))
                })),
            },
        )?;
    }
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

#[cfg(test)]
mod tests {
    use super::left_to_the_living;

    #[test]
    fn a_strong_medium_refuses_people_and_a_full_one_leaves_them_nothing() {
        assert_eq!(left_to_the_living(0.0), 1.0);
        assert_eq!(left_to_the_living(0.6), 1.0);
        assert!((left_to_the_living(0.8) - 0.5).abs() < 1e-12);
        assert_eq!(left_to_the_living(1.0), 0.0);
        assert_eq!(left_to_the_living(1.5), 0.0);
    }
}
