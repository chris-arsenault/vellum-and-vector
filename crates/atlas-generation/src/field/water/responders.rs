use super::failure;
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{ExecutionResult, QueryDependency},
    field::Field,
    scale::{LengthUnit, MapScale, RelativeMeasure},
    water::groundwater::return_rate,
};
// Arconis: docs/architecture/subsystems.arconis#item=r_wet — wetness from climate, plus groundwater, greenwood, salt and wetlands.
pub fn respond(
    book: &mut QuestionBook<Field, &'static str>,
    runoff: QueryDependency<Field>,
    melt: QueryDependency<Field>,
    reference_runoff: f64,
) -> ExecutionResult<()> {
    for (key, by, value) in [
        ("waterWithdrawal", "surface water", 0.0),
        ("waterTransmission", "surface water", 1.0),
        ("soilWetting", "soil water", 0.0),
        ("soilWaterHeld", "soil water", 0.0),
    ] {
        book.respond(
            key,
            Responder {
                by: by.into(),
                queries: vec![],
                kind: ResponseKind::Base(Box::new(move |_, _, _| Ok(value))),
            },
        )?;
    }
    book.respond(
        "seaStand",
        Responder {
            by: "the sea".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, _, _| {
                Ok(field.water.borrow().effective_sea_level())
            })),
        },
    )?;
    book.respond(
        "surfaceWater",
        Responder {
            by: "climate".into(),
            queries: vec![runoff.clone()],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                field.water.borrow().mean_runoff(cell).map_err(failure)
            })),
        },
    )?;
    book.respond(
        "wetness",
        Responder {
            by: "climate".into(),
            queries: vec![runoff],
            kind: ResponseKind::Base(Box::new(move |field, cell, _| {
                Ok(field.water.borrow().mean_runoff(cell).map_err(failure)?
                    / (reference_runoff * 2.0))
            })),
        },
    )?;
    book.respond(
        "surfaceWater",
        Responder {
            by: "ice melt".into(),
            queries: vec![melt],
            kind: ResponseKind::Add(Box::new(|field, cell, _| {
                let water = field.water();
                if water.column.kind.get(cell).map_err(failure)? == 1 {
                    Ok(0.0)
                } else {
                    water.melt.glacial.get(cell).map_err(failure)
                }
            })),
        },
    )?;
    book.respond(
        "surfaceWater",
        Responder {
            by: "groundwater springs".into(),
            queries: vec![],
            kind: ResponseKind::Add(Box::new(|field, cell, _| {
                let ground = field.water().groundwater;
                Ok(MapScale::in_units(
                    return_rate(ground.returned.get(cell).map_err(failure)?, ground.interval),
                    LengthUnit::Millimetre,
                ))
            })),
        },
    )?;
    book.respond(
        "wetness",
        Responder {
            by: "groundwater return".into(),
            queries: vec![],
            kind: ResponseKind::Add(Box::new(|field, cell, _| {
                let depth = field
                    .scale
                    .resolve(RelativeMeasure::length(2.5e-7).map_err(failure)?)
                    .map_err(failure)?
                    .value();
                Ok(field
                    .water()
                    .groundwater
                    .returned
                    .get(cell)
                    .map_err(failure)?
                    / depth)
            })),
        },
    )?;
    book.respond(
        "discharge",
        Responder {
            by: "surface water".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(move |_, _, answer| {
                Ok(answer.ask("surfaceWater")? / reference_runoff)
            })),
        },
    )
}
