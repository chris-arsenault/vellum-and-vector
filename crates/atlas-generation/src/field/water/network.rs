mod lakes;
mod settings;
use super::{drainage::bed, failure};
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, Query, QueryDependency},
    field::{climate::settings::Settings as Climate, shared::Scalar as S, Field},
    rock::{
        columns::Column,
        ground::{Ground, GroundField},
    },
    settlement::removal::Facet,
    storage::ReadBand,
    water::{
        column::{Store, WaterColumnView},
        owner_network::NetworkEnvironment,
        substrate,
    },
};
pub use settings::{settings, Settings};
use std::{io, rc::Rc};
#[derive(Clone)]
pub struct Questions {
    pub surface_water: Query<Field, AnswerBand>,
    pub withdrawal: Query<Field, AnswerBand>,
    pub transmission: Query<Field, AnswerBand>,
}
struct Answers {
    surface_water: ReadBand<f64>,
    withdrawal: ReadBand<f64>,
    transmission: ReadBand<f64>,
}
impl Questions {
    fn dependencies(&self) -> [QueryDependency<Field>; 3] {
        [
            self.surface_water.dependency(),
            self.withdrawal.dependency(),
            self.transmission.dependency(),
        ]
    }
}
pub struct RiverEvolution {
    pub channel_length: Option<ReadBand<f64>>,
}
fn permeability(ground: &Ground, cell: usize, column: Option<Column>) -> io::Result<f64> {
    substrate::permeability(
        ground,
        cell,
        column.map(|column| {
            if column == Column::Cut {
                Facet::Cut
            } else {
                Facet::Land
            }
        }),
    )
}
fn filled(column: &WaterColumnView, cell: usize) -> io::Result<f64> {
    let store = column.store(Store::Ground);
    let capacity = store.capacity(cell)?;
    Ok(if capacity > 0.0 {
        (store.held(cell)? / capacity).clamp(0.0, 1.0)
    } else {
        1.0
    })
}
fn run(
    field: &Field,
    p: &Settings,
    climate: &Climate,
    answers: Answers,
    evolution: Option<&RiverEvolution>,
) -> io::Result<()> {
    let losses = lakes::losses(field, p, climate)?;
    let column = field.water().column;
    let ground = field.ground();
    let environment = NetworkEnvironment {
        surface_water: &answers.surface_water,
        bed: &|cell| bed(&ground, cell),
        cut_share: &ground.view(GroundField::GroundCutShare),
        permeability: &|cell, facet| permeability(&ground, cell, facet),
        groundwater_filled: &|cell| filled(&column, cell),
        open_bed_seepage: p.open_bed_seepage,
        withdrawal: answers.withdrawal,
        transmission: answers.transmission,
        lake_evaporation: losses[0],
        lake_seepage: losses[1],
        lake_infiltration_loss: p.lake_infiltration_loss,
        epoch: ground.completed_epochs(),
    };
    let mut water = field.water.borrow_mut();
    let mut coverage = field.coverage.borrow_mut();
    if let Some(input) = evolution {
        water.advance_network(environment, input.channel_length.as_ref(), &mut coverage)
    } else {
        water.refresh_network(environment, &mut coverage)
    }
}
impl Field {
    pub fn capture_small_channel_length(&self) -> io::Result<ReadBand<f64>> {
        let source = self.water().small_channel_length;
        let mut values = self.coverage.borrow_mut().allocate(0.0);
        for cell in 0..source.len() {
            values.set(cell, source.get(cell)?)?;
        }
        Ok(values.read_only())
    }
    pub fn river_network(
        p: Rc<Settings>,
        climate: Rc<Climate>,
        questions: Questions,
        mut dependencies: Vec<QueryDependency<Self>>,
    ) -> Query<Self, ()> {
        dependencies.extend(questions.dependencies());
        Query::new(
            "river-network",
            dependencies,
            move |field: &Field, scope| {
                let answers = Answers {
                    surface_water: scope.get(&questions.surface_water)?.values(),
                    withdrawal: scope.get(&questions.withdrawal)?.values(),
                    transmission: scope.get(&questions.transmission)?.values(),
                };
                run(field, &p, &climate, answers, None).map_err(failure)
            },
        )
    }
    pub fn river_evolution(
        p: Rc<Settings>,
        climate: Rc<Climate>,
        questions: Questions,
        mut dependencies: Vec<QueryDependency<Self>>,
    ) -> Command<Self, RiverEvolution> {
        dependencies.extend(questions.dependencies());
        Command::with_inputs(
            "river-evolution",
            CommandKind::Work,
            dependencies,
            move |scope, input| {
                let (field, values) = scope.parts();
                let answers = Answers {
                    surface_water: values.get(&questions.surface_water)?.values(),
                    withdrawal: values.get(&questions.withdrawal)?.values(),
                    transmission: values.get(&questions.transmission)?.values(),
                };
                run(field, &p, &climate, answers, Some(input)).map_err(failure)
            },
        )
    }
    pub fn river_heat(dependencies: Vec<QueryDependency<Self>>) -> Query<Self, ()> {
        Query::new("river-warmth", dependencies, |field: &Field, _| {
            field
                .water
                .borrow_mut()
                .river_warmth(
                    &field.shared.scalar(S::Warmth),
                    &mut field.coverage.borrow_mut(),
                )
                .map_err(failure)
        })
    }
}
