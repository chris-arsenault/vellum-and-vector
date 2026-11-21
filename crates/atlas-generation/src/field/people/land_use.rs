//! How people use the land, as the living land asks it: the share they keep under fields and
//! buildings, under pasture, and how hard they hunt and fish. Ecology asks these shared
//! questions and names no human layer; a craft could break any of them.
use super::facts::HUNTERS_HALF;
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::ExecutionResult,
    field::Field,
    human::{catalogue::LayerId, HumanField},
};
use std::io;
/// How heavily people at `density` per km² hunt and fish, from 0 to 1.
pub fn taking(density: f64) -> f64 {
    let density = density.max(0.0);
    density / (density + HUNTERS_HALF)
}
fn layer(field: &Field, id: LayerId, cell: usize) -> io::Result<f64> {
    field.people.view(HumanField::Layer(id)).get(cell)
}
/// The share of a cell under fields and buildings, where nothing wild grows.
fn cleared(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(
        (layer(field, LayerId::Farmland, cell)? + layer(field, LayerId::BuiltUp, cell)?)
            .clamp(0.0, 1.0),
    )
}
pub fn respond(book: &mut QuestionBook<Field, &'static str>) -> ExecutionResult<()> {
    book.respond(
        "cleared",
        Responder {
            by: "fields and buildings".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| Ok(cleared(field, cell)?))),
        },
    )?;
    book.respond(
        "grazed",
        Responder {
            by: "herds".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                Ok(layer(field, LayerId::Pasture, cell)?.clamp(0.0, 1.0))
            })),
        },
    )?;
    book.respond(
        "fished",
        Responder {
            // Shore people fish whatever else they live by.
            by: "the people of the shore".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                Ok(taking(field.people.people(cell)?))
            })),
        },
    )?;
    book.respond(
        "hunted",
        Responder {
            // People who live by fields and herds hunt little; the wild is hunted by those
            // who live on it.
            by: "the people of the wild".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                let worked =
                    (cleared(field, cell)? + layer(field, LayerId::Pasture, cell)?).clamp(0.0, 1.0);
                Ok(taking(field.people.people(cell)?) * (1.0 - worked))
            })),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::taking;

    #[test]
    fn more_people_take_more_up_to_all_there_is() {
        assert_eq!(taking(0.0), 0.0);
        assert!(taking(200.0) > taking(20.0));
        assert!((taking(20.0) - 0.5).abs() < 1e-12);
        assert!(taking(1e9) <= 1.0);
    }
}
