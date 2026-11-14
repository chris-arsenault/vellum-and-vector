use super::failure;
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, Query, QueryDependency},
    field::{
        climate::settings::Settings as Climate,
        shared::{CellCode as C, Scalar as S},
        Field,
    },
    processes::runner::PhysicalContext,
    rock::ground::{
        query::{average, ground_fact, Fact, GroundQuery},
        GroundField,
    },
    scale_settings::{ResolvedSettings, ScaleDefinition},
    water::{
        groundwater::GroundwaterInputs,
        meltwater::MeltInputs,
        runoff::{self, ClimateBands, ClimateSettings, LandWaterInputs},
        substrate,
    },
};
use serde::Deserialize;
use std::rc::Rc;
pub fn settings() -> ScaleDefinition {
    ScaleDefinition::from_value(serde_json::json!({"kind":"relative-settings","values":{
        "SnowMeltPerDegree":{"kind":"relative-measure","fraction":3.05e-8,"dimension":1,"exponent":1,"unit":"mm"},
        "StormRunoffShare":0.1,"GlacialMeltTemperatureFloor":170,"IceTemperatureThreshold":285
    }})).expect("Declared water transfer settings")
}
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Settings {
    snow_melt_per_degree: f64,
    storm_runoff_share: f64,
    glacial_melt_temperature_floor: f64,
    ice_temperature_threshold: f64,
}
impl Settings {
    pub fn from_resolved(settings: &ResolvedSettings) -> Result<Self, serde_json::Error> {
        serde_json::from_value(settings.values().clone())
    }
}
pub struct SoilQuestions {
    pub wetting: Query<Field, AnswerBand>,
    pub held: Query<Field, AnswerBand>,
}
impl Field {
    pub fn water_column_transfer(
        p: Rc<Settings>,
        climate: Rc<Climate>,
        questions: SoilQuestions,
        mut dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, PhysicalContext> {
        dependencies.extend([questions.wetting.dependency(), questions.held.dependency()]);
        Command::with_inputs(
            "water-column-transfer",
            CommandKind::Work,
            dependencies,
            move |scope, _| {
                let (field, values) = scope.parts();
                let wetting = values.get(&questions.wetting)?.values();
                let held = values.get(&questions.held)?.values();
                let ground = field.ground();
                let mut porosity = GroundQuery::new(0.0);
                porosity.rock = Some(Box::new(|_, layer, _| ground_fact(layer, Fact::Porosity)));
                let porosity = average(porosity);
                let read = |name, cell| field.shared.scalar(name).get(cell);
                let bands = ClimateBands {
                    temperature: field.shared.scalar(S::Temperature),
                    seasonality: field.shared.scalar(S::Seasonality),
                    rainfall: field.shared.scalar(S::Rainfall),
                    snowfall: field.shared.scalar(S::Snowfall),
                    river_warmth: field.water().warmth,
                };
                field
                    .water
                    .borrow_mut()
                    .advance_year(LandWaterInputs {
                        mesh: &field.mesh,
                        climate: &bands,
                        settings: ClimateSettings {
                            frame: &climate.latitude(),
                            belts: &climate.belts(),
                            seasonality_equator: climate.seasonality_equator,
                            seasonality_polar: climate.seasonality_polar,
                            snow_melt_per_degree: p.snow_melt_per_degree,
                            storm_runoff_share: p.storm_runoff_share,
                        },
                        sinking: &|cell| {
                            Ok(runoff::sinking_share(
                                if field.ecology_initialized {
                                    read(S::Infiltration, cell)?
                                } else {
                                    ground.fold(cell, &porosity, None)?
                                },
                                read(S::WetlandCover, cell)?,
                                read(S::PeatCarbon, cell)?,
                                field.ecology_initialized,
                            ))
                        },
                        bare: &|cell| {
                            Ok(runoff::bare(
                                read(S::TreeCover, cell)?,
                                read(S::GrassCover, cell)?,
                                read(S::WetlandCover, cell)?,
                            ))
                        },
                        wetting: &wetting,
                        held: &held,
                    })
                    .map_err(failure)
            },
        )
    }
    pub fn groundwater_transfer(
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, PhysicalContext> {
        Command::with_inputs(
            "groundwater",
            CommandKind::Work,
            dependencies,
            |scope, c: &PhysicalContext| {
                let field: &mut Field = scope.state_mut();
                let water = field.water();
                let ground = field.ground();
                field
                    .water
                    .borrow_mut()
                    .advance_groundwater(
                        GroundwaterInputs {
                            mesh: &field.mesh,
                            scale: &field.scale,
                            water_kind: &water.column.kind,
                            elevation: &ground.view(GroundField::Elevation),
                            recharge: &water.column.year[12],
                            seepage: &water.flow.seepage,
                            permeability: &|cell| substrate::permeability(&ground, cell, None),
                            sea_level: water.effective_sea_level,
                            exposure: c.span.max(0.0),
                        },
                        &mut field.coverage.borrow_mut(),
                    )
                    .map_err(failure)
            },
        )
    }
    pub fn glacial_meltwater(
        p: Rc<Settings>,
        dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        Query::new(
            "glacial-meltwater",
            dependencies,
            move |field: &Field, _| {
                let water = field.water();
                field
                    .water
                    .borrow_mut()
                    .release_meltwater(
                        MeltInputs {
                            mesh: &field.mesh,
                            water_kind: &water.column.kind,
                            ice_thickness: &field.shared.scalar(S::IceThickness),
                            snow_kept: &water.column.year[13],
                            temperature: &field.shared.scalar(S::Temperature),
                            targets: &field.shared.code(C::IceFlowTargets),
                            temperature_floor: p.glacial_melt_temperature_floor,
                            ice_threshold: p.ice_temperature_threshold,
                        },
                        &mut field.coverage.borrow_mut(),
                    )
                    .map_err(failure)
            },
        )
    }
}
