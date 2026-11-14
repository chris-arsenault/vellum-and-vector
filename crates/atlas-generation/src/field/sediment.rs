//! Resolve the actual water owner and coupled passage inputs before sediment changes ground.
use super::Field;
use crate::{
    answers::AnswerBand,
    execution::{ExecutionError, Query, QueryDependency},
    rock::{columns::Column, ground::GroundField},
    settlement::removal::Facet,
    water::{column::Store, passage::PassageInputs, sediment::SedimentRouting, substrate},
};

pub struct PassageQuestions {
    pub discharge: Query<Field, AnswerBand>,
    pub withdrawal: Query<Field, AnswerBand>,
    pub transmission: Query<Field, AnswerBand>,
}
pub fn respond(
    book: &mut crate::answers::QuestionBook<Field, &'static str>,
    carry: f64,
) -> crate::execution::ExecutionResult<()> {
    use crate::answers::{Responder, ResponseKind};
    book.respond(
        "loadCapacity",
        Responder {
            by: "flowing water".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(move |field, cell, _| {
                Ok(carry
                    * field
                        .shared
                        .scalar(super::shared::Scalar::Slope)
                        .get(cell)
                        .map_err(failed)?)
            })),
        },
    )?;
    book.respond(
        "looseSupply",
        Responder {
            by: "worn ground".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                field
                    .ground_load
                    .supply()
                    .expect("Ground load has a depth projection")
                    .get(cell)
                    .map_err(failed)
            })),
        },
    )
}
fn failed(error: impl std::fmt::Display) -> ExecutionError {
    ExecutionError::Failed(error.to_string())
}
impl Field {
    pub fn sediment_routing(
        questions: PassageQuestions,
        reference_runoff: f64,
        open_bed_seepage: f64,
        mut dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, SedimentRouting> {
        dependencies.extend([
            questions.discharge.dependency(),
            questions.withdrawal.dependency(),
            questions.transmission.dependency(),
        ]);
        Query::new(
            "sediment-routing",
            dependencies,
            move |field: &Field, reader| {
                let discharge = reader.get(&questions.discharge)?.values();
                let withdrawal = reader.get(&questions.withdrawal)?.values();
                let transmission = reader.get(&questions.transmission)?.values();
                let ground = field.ground.try_borrow().map_err(failed)?;
                let mut water = field.water.try_borrow_mut().map_err(failed)?;
                let column = water.read_only().column;
                let permeability = |cell, column: Option<Column>| {
                    substrate::permeability(
                        &ground,
                        cell,
                        column.map(|column| {
                            if column == Column::Cut {
                                Facet::Cut
                            } else {
                                Facet::Land
                            }
                        }),
                    )
                };
                let filled = |cell| {
                    let store = column.store(Store::Ground);
                    let capacity = store.capacity(cell)?;
                    Ok(if capacity > 0.0 {
                        (store.held(cell)? / capacity).clamp(0.0, 1.0)
                    } else {
                        1.0
                    })
                };
                water
                    .sediment_routing(
                        PassageInputs {
                            mesh: &field.mesh,
                            water_kind: &column.kind,
                            cut_share: &ground.view(GroundField::GroundCutShare),
                            permeability: &permeability,
                            filled: &filled,
                            open_bed_seepage,
                            withdrawal,
                            transmission,
                        },
                        &discharge,
                        reference_runoff,
                        &mut field.coverage.borrow_mut(),
                    )
                    .map_err(failed)
            },
        )
    }
}
