//! Burial, dry closed-water salt and metamorphism from rock/rockHistory.ts.
use super::runner::{io_error, PhysicalContext};
use crate::{
    answers::{AnswerBand, QuestionBook, Responder, ResponseKind},
    execution::{Command, CommandKind, ExecutionError, ExecutionResult, Query},
    field::{shared::Scalar, Field},
    rock::{catalogue, ground::GroundField},
    scale::{LengthUnit, MapScale, RelativeMeasure},
    settlement::{removal::RemovalGround, stage::Pool},
    water::column::Store,
};
use std::io;

const LITHIFY_FROM: f64 = 0.00025;
const STILL_LOOSE_PER_SPAN: f64 = 0.5;
const DRY_BASIN: f64 = 1e-7;
const SALT_PER_SPAN: f64 = 0.000025;
const BAKING_CONSTRUCTION: f64 = 0.00003;
const BAKING_DEPTH: f64 = 0.0003;
const FULL_HEAT: f64 = 1.0;
const SUTURE_HEAT: f64 = 0.5;

fn length(scale: &MapScale, fraction: f64) -> io::Result<f64> {
    Ok(scale
        .resolve(RelativeMeasure::length(fraction).map_err(io::Error::other)?)
        .map_err(io::Error::other)?
        .value())
}
pub fn lithification() -> Command<Field, PhysicalContext> {
    Field::material_command(
        "lithification",
        CommandKind::Work,
        vec![],
        |work, context: &PhysicalContext, _| {
            let scale = *work.ground.scale();
            let dry = length(&scale, DRY_BASIN)?;
            let salt = MapScale::native(length(&scale, SALT_PER_SPAN)? * context.span);
            let rain = work.shared.scalar(Scalar::Rainfall);
            for cell in 0..work.mesh.len() {
                if work.water.column.kind.get(cell)? != 2
                    || work.water.column.lake_overflow.get(cell)? > 0.0
                {
                    continue;
                }
                if MapScale::metres(rain.get(cell)?, LengthUnit::Millimetre) >= dry {
                    continue;
                }
                let depth = salt.min(
                    work.water
                        .column
                        .store(Store::Standing)
                        .contents()
                        .get(cell)?,
                );
                if depth <= 0.0 {
                    continue;
                }
                let material =
                    catalogue::material(catalogue::SALT_BED, depth, work.ground.completed_epochs());
                work.ground
                    .construct_material(cell, &material, "burial", Pool::Sea, None)?;
            }
            let from = MapScale::native(length(&scale, LITHIFY_FROM)?);
            let hardened = 1.0 - STILL_LOOSE_PER_SPAN.powf(context.span);
            for cell in 0..work.mesh.len() {
                work.ground.lithify_buried(cell, from, hardened, "burial")?;
            }
            Ok(())
        },
    )
}
// Arconis: docs/architecture/subsystems.arconis#item=c_heat — bakes buried rock by heat into metamorphic rock.
pub fn metamorphism(heat: Query<Field, AnswerBand>) -> Command<Field> {
    Field::material_command(
        "rock-metamorphism",
        CommandKind::Work,
        vec![heat.dependency()],
        move |work, _, values| {
            let heat = values.get(&heat).map_err(io_error)?.values();
            let depth = MapScale::native(length(work.ground.scale(), BAKING_DEPTH)?);
            for cell in 0..work.mesh.len() {
                let heat = heat.get(cell)?;
                if heat > 0.0 {
                    work.ground.metamorphose_below(cell, depth / heat)?;
                }
            }
            Ok(())
        },
    )
}
pub fn respond(book: &mut QuestionBook<Field, &'static str>) -> ExecutionResult<()> {
    book.respond(
        "heat",
        Responder {
            by: "burial".into(),
            queries: vec![],
            kind: ResponseKind::Base(Box::new(|field, cell, _| {
                let result = (|| {
                    let ground = field.ground();
                    let constructed = field
                        .shared()
                        .scalar(Scalar::OrogenicConstruction)
                        .get(cell)?;
                    let buried = (constructed
                        / MapScale::native(length(ground.scale(), BAKING_CONSTRUCTION)?))
                    .min(FULL_HEAT);
                    Ok::<_, io::Error>(buried.max(
                        ground.view(GroundField::CrustSutureStrength).get(cell)? / 1000.0
                            * SUTURE_HEAT,
                    ))
                })();
                result.map_err(|error| ExecutionError::Failed(error.to_string()))
            })),
        },
    )
}
