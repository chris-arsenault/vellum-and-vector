use super::{filled, permeability, Answers, Climate, Questions, Settings};
use crate::{
    climate::air_year,
    execution::{Query, QueryDependency},
    field::{shared::Scalar as S, Field},
    processes::runner::PhysicalContext,
    rock::ground::GroundField,
    storage::ReadBand,
    water::{
        lake_stage::{depth_discharge, open_water_loss, LakeCriteria, StageInputs},
        lakes::LakeInputs,
        passage::PassageInputs,
    },
};
use std::{io, rc::Rc};
fn loss(field: &Field, climate: &Climate, cell: usize) -> io::Result<f64> {
    let read = |name| field.shared.scalar(name).get(cell);
    let latitude = climate
        .latitude()
        .latitude_at_y(field.mesh.position(cell)[1] + field.mesh.origin()[1]);
    let demand = air_year(
        latitude,
        climate.axial_tilt,
        read(S::Temperature)?,
        read(S::Seasonality)?,
        0.0,
    )
    .demand
    .iter()
    .sum();
    let water = field.water();
    Ok(open_water_loss(
        demand,
        read(S::Rainfall)?,
        read(S::Snowfall)?,
        water.runoff.mean.get(cell)?,
        water.column.year[12].get(cell)?,
        water.column.year[13].get(cell)?,
    ))
}
pub(super) fn losses(field: &Field, p: &Settings, climate: &Climate) -> io::Result<[f64; 2]> {
    let mut result = [0.0; 2];
    let water = field.water().column.kind;
    for cell in 0..field.mesh.len() {
        if water.get(cell)? != 2 {
            continue;
        }
        result[0] += depth_discharge(loss(field, climate, cell)?, field.mesh.area(cell));
        result[1] += depth_discharge(p.lake_infiltration_loss, field.mesh.area(cell));
    }
    Ok(result)
}
struct Inputs<'a> {
    settings: &'a Settings,
    climate: &'a Climate,
    context: &'a PhysicalContext,
    answers: Answers,
    dams: Option<&'a ReadBand<u8>>,
}
fn run(field: &Field, input: Inputs<'_>) -> io::Result<()> {
    let water = field.water();
    let ground = field.ground();
    // Compute demand before acquiring the water writer; its runoff and monthly stores are inputs.
    let mut losses = field.coverage.borrow_mut().scratch(field.mesh.len(), 0.0);
    for cell in 0..field.mesh.len() {
        losses.set(cell, loss(field, input.climate, cell)?)?;
    }
    let p = input.settings;
    field.water.borrow_mut().lake_basins_with_passage(
        LakeInputs {
            stage: StageInputs {
                mesh: &field.mesh,
                elevation: &ground.view(GroundField::Elevation),
                parents: &water.drainage.parents,
                open_water_loss: &|cell| losses.get(cell),
                infiltration_loss: p.lake_infiltration_loss,
            },
            drainage: &water.drainage,
            scale: &field.scale,
            surface_water: &input.answers.surface_water,
            incoming: None,
            passage: &|_, amount| Ok(amount),
            criteria: LakeCriteria {
                minimum_area: p.minimum_lake_area,
                depth_threshold: p.lake_depth_threshold,
                compactness_share: p.lake_compactness_share,
                dams: input.dams,
            },
            seed: input.context.seed,
        },
        PassageInputs {
            mesh: &field.mesh,
            water_kind: &water.column.kind,
            cut_share: &ground.view(GroundField::GroundCutShare),
            permeability: &|cell, facet| permeability(&ground, cell, facet),
            filled: &|cell| filled(&water.column, cell),
            open_bed_seepage: p.open_bed_seepage,
            withdrawal: input.answers.withdrawal,
            transmission: input.answers.transmission,
        },
        &mut field.coverage.borrow_mut(),
    )
}
impl Field {
    pub fn lake_basins(
        p: Rc<Settings>,
        climate: Rc<Climate>,
        questions: Questions,
        dams: Option<Query<Self, ReadBand<u8>>>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new("lake-basins", dependencies, move |field: &Field, scope| {
            field
                .water
                .borrow_mut()
                .prepare_lakes()
                .map_err(super::super::failure)?;
            let c = scope.input::<PhysicalContext>()?;
            let answers = Answers {
                surface_water: scope.get(&questions.surface_water)?.values(),
                withdrawal: scope.get(&questions.withdrawal)?.values(),
                transmission: scope.get(&questions.transmission)?.values(),
            };
            let dams = dams.as_ref().map(|query| scope.get(query)).transpose()?;
            run(
                field,
                Inputs {
                    settings: &p,
                    climate: &climate,
                    context: &c,
                    answers,
                    dams: dams.as_deref(),
                },
            )
            .map_err(super::super::failure)
        })
    }
}
