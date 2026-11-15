// Arconis: docs/architecture/subsystems.arconis#item=c_season — answers crop and herd yields from what the land feeds.
use super::travel::length;
use crate::{
    answers::{QuestionBook, Responder, ResponseKind},
    execution::{ExecutionResult, Query, QueryDependency},
    field::{shared::Scalar as S, Field},
    human::{catalogue::LayerId, HumanField},
    rock::ground::GroundField,
    storage::ReadBand,
    water::{column::Store, soil},
};
use std::io;

fn read(field: &Field, name: S, cell: usize) -> io::Result<f64> {
    field.shared.scalar(name).get(cell)
}
fn ice_free(field: &Field, cell: usize) -> io::Result<f64> {
    Ok(1.0 - (read(field, S::IceThickness, cell)? / length(field, 0.00025)?).min(1.0))
}
fn quickened(field: &Field, cell: usize, stilled: f64) -> io::Result<f64> {
    Ok((1.0 + 0.5 * read(field, S::Quickening, cell)?)
        * (1.0 - stilled * read(field, S::Stillness, cell)?))
}
fn river(field: &Field, cell: usize, orders: &ReadBand<u32>) -> io::Result<f64> {
    Ok(if orders.get(cell)? > 0 {
        (field.water().channels.strength.get(cell)? / 1000.0).min(1.0)
    } else {
        0.0
    })
}
fn shore_catch(field: &Field, cell: usize) -> io::Result<f64> {
    let mut seas = 0;
    let mut fauna = 0.0;
    let mut upwelling = 0.0f64;
    let water = field.water().column.kind;
    for edge in 0..3 {
        let Some(next) = field.mesh.neighbor(cell, edge) else {
            continue;
        };
        if water.get(next)? != 1 {
            continue;
        }
        seas += 1;
        fauna += read(field, S::AquaticFauna, next)?;
        upwelling = upwelling.max(read(field, S::Upwelling, next)? / 1000.0);
    }
    Ok(if seas > 0 {
        0.5 + 4.0 * fauna / f64::from(seas) + 2.0 * upwelling
    } else {
        0.0
    })
}
pub fn respond(
    book: &mut QuestionBook<Field, &'static str>,
    rivers: Query<Field, ReadBand<u32>>,
    dependencies: Vec<QueryDependency<Field>>,
) -> ExecutionResult<()> {
    book.respond(
        "season",
        Responder {
            by: "climate and ice".into(),
            queries: dependencies.clone(),
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                Ok(
                    (-((read(field, S::Temperature, cell)? - 480.0) / 200.0).powi(2)).exp()
                        * ice_free(field, cell)?,
                )
            })),
        },
    )?;
    let mut water_reads = dependencies.clone();
    water_reads.push(rivers.dependency());
    let crop_rivers = rivers.clone();
    book.respond(
        "cropYield",
        Responder {
            by: "soil, water and season".into(),
            queries: water_reads.clone(),
            kind: ResponseKind::Base(Box::new(move |field, cell, answers| {
                let water = field.water();
                if water.column.kind.get(cell)? != 0 {
                    return Ok(0.0);
                }
                let soil_depth = (field.ground().view(GroundField::SoilDepth).get(cell)?
                    / length(field, 1.25e-7)?)
                .min(1.0);
                let stored = water.column.store(Store::Soil);
                let filled = soil::filled(stored.held(cell)?, stored.capacity(cell)?);
                let wet = (read(field, S::Moisture, cell)? / 1000.0)
                    .max(river(
                        field,
                        cell,
                        answers.queries().get(&crop_rivers)?.as_ref(),
                    )?)
                    .max(filled)
                    .min(1.0);
                Ok(35.0
                    * answers.ask("season")?
                    * soil_depth
                    * wet
                    * (-12.0 * read(field, S::Slope, cell)?).exp()
                    * (1.0 - 0.8 * read(field, S::TreeCover, cell)?)
                    * quickened(field, cell, 0.8)?)
            })),
        },
    )?;
    book.respond(
        "herdYield",
        Responder {
            by: "grass and season".into(),
            queries: dependencies,
            kind: ResponseKind::Base(Box::new(|field, cell, answers| {
                Ok(if field.water().column.kind.get(cell)? == 0 {
                    5.0 * read(field, S::GrassCover, cell)?
                        * answers.ask("season")?
                        * quickened(field, cell, 0.5)?
                } else {
                    0.0
                })
            })),
        },
    )?;
    book.respond(
        "wildYield",
        Responder {
            by: "woods, game and water".into(),
            queries: water_reads,
            kind: ResponseKind::Base(Box::new(move |field, cell, answers| {
                if field.water().column.kind.get(cell)? != 0 {
                    return Ok(0.0);
                }
                let gathered = 2.0
                    * read(field, S::TreeCover, cell)?
                    * (3.0 * read(field, S::Productivity, cell)?.max(0.0)).min(1.0)
                    + 2.0 * read(field, S::Herbivores, cell)?;
                let fished = river(field, cell, answers.queries().get(&rivers)?.as_ref())?
                    * (0.5 + 4.0 * read(field, S::AquaticFauna, cell)?)
                    + shore_catch(field, cell)?;
                Ok((gathered + fished) * ice_free(field, cell)?)
            })),
        },
    )?;
    book.respond(
        "support",
        Responder {
            by: "the land as it is used".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, answers| {
                let crop = field
                    .people
                    .view(HumanField::Layer(LayerId::Farmland))
                    .get(cell)?;
                let herd = field
                    .people
                    .view(HumanField::Layer(LayerId::Pasture))
                    .get(cell)?;
                let built = field
                    .people
                    .view(HumanField::Layer(LayerId::BuiltUp))
                    .get(cell)?;
                Ok(crop * answers.ask("cropYield")?
                    + herd * answers.ask("herdYield")?
                    + (1.0 - crop - herd - built).max(0.0) * answers.ask("wildYield")?)
            })),
        },
    )
}
