use super::effect_declarations::WaterInfluences;
use crate::{
    answers::{QuestionBook, Responder, Response, ResponseKind},
    execution::{ExecutionResult, Query},
    field::Field,
};
use std::{cell::RefCell, rc::Rc};

/// The supplied query only refreshes place answers; it never executes material effects.
pub fn respond(
    book: &mut QuestionBook<Field, &'static str>,
    water: Rc<RefCell<WaterInfluences>>,
    refresh: Query<Field, ()>,
) -> ExecutionResult<()> {
    for key in [
        "waterWithdrawal",
        "waterTransmission",
        "soilWetting",
        "soilWaterHeld",
    ] {
        let values = water.clone();
        let read: Box<Response<Field, &'static str>> = Box::new(move |_, cell, _| {
            let water = values.borrow();
            let band = match key {
                "waterWithdrawal" => &water.withdrawal,
                "waterTransmission" => &water.transmission,
                "soilWetting" => &water.soil_wetting,
                _ => &water.soil_held,
            };
            Ok(band.get(cell)?)
        });
        book.respond(
            key,
            Responder {
                by: "maintained places".into(),
                queries: vec![refresh.dependency()],
                kind: if key == "waterTransmission" {
                    ResponseKind::Scale(read)
                } else {
                    ResponseKind::Add(read)
                },
            },
        )?;
    }
    Ok(())
}
