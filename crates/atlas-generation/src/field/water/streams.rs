use super::{drainage, failure};
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, Query, QueryDependency},
    field::{sediment::PassageQuestions, shared::Scalar as S, Field},
    processes::runner::{PhysicalContext, StageWork},
    rock::{catalogue, columns::Column, ground::GroundField, ModeId, ModeMix},
    settlement::removal::Facet,
    storage::ReadBand,
    water::{
        column::Store, guidance::GuidanceInputs, passage::PassageInputs, streams::StreamRouting,
        substrate,
    },
};
use std::{cell::RefCell, io, rc::Rc};
pub struct Settings {
    pub drainage: Rc<drainage::Settings>,
    pub open_boundary: bool,
    pub reference_runoff: f64,
    pub open_bed_seepage: f64,
}
pub struct Questions {
    pub passage: PassageQuestions,
    pub roots: Query<Field, AnswerBand>,
    pub conditioning: Query<Field, ()>,
}
impl Questions {
    pub fn dependencies(&self) -> Vec<QueryDependency<Field>> {
        vec![
            self.passage.discharge.dependency(),
            self.passage.withdrawal.dependency(),
            self.passage.transmission.dependency(),
            self.roots.dependency(),
        ]
    }
}
struct Inputs {
    context: PhysicalContext,
    discharge: ReadBand<f64>,
    withdrawal: ReadBand<f64>,
    transmission: ReadBand<f64>,
}
pub type PreparedRouting = Rc<RefCell<Option<StreamRouting>>>;
fn route(field: &Field, p: &Settings, input: &Inputs) -> io::Result<StreamRouting> {
    let ground = field.ground();
    let water = field.water();
    let mix = catalogue::compile(
        ModeMix::default()
            .with(ModeId::Abrasion, 0.6)
            .with(ModeId::Plucking, 0.4),
    );
    let c = &input.context;
    field.water.borrow_mut().stream_routing(
        GuidanceInputs {
            mesh: &field.mesh,
            scale: &field.scale,
            water_kind: &water.column.kind,
            elevation: &ground.view(GroundField::Elevation),
            fluvial_erosion: &field.shared.scalar(S::CumulativeFluvialErosion),
            glacial_erosion: &field.shared.scalar(S::CumulativeGlacialErosion),
            open_boundary: p.open_boundary,
            seed: c.seed,
            epoch_stable_seed: c.epoch_stable_seed,
            response: &|cell, next| ground.face_gives_from(cell, &mix)?.at(next),
            settings: &p.drainage.guidance(),
        },
        PassageInputs {
            mesh: &field.mesh,
            water_kind: &water.column.kind,
            cut_share: &ground.view(GroundField::GroundCutShare),
            permeability: &|cell, column: Option<Column>| {
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
            },
            filled: &|cell| {
                let store = water.column.store(Store::Ground);
                let capacity = store.capacity(cell)?;
                Ok(if capacity > 0.0 {
                    (store.held(cell)? / capacity).clamp(0.0, 1.0)
                } else {
                    1.0
                })
            },
            open_bed_seepage: p.open_bed_seepage,
            withdrawal: input.withdrawal.clone(),
            transmission: input.transmission.clone(),
        },
        &input.discharge,
        p.reference_runoff,
        &mut field.coverage.borrow_mut(),
    )
}
impl Field {
    pub fn stream_preparation(
        p: Settings,
        questions: Questions,
        prepared: PreparedRouting,
    ) -> Command<Self, StageWork> {
        let dependencies = questions.dependencies();
        let target = prepared.clone();
        let routed = Command::with_inputs(
            "stream-routes",
            CommandKind::Work,
            vec![
                questions.conditioning.dependency(),
                questions.roots.dependency(),
            ],
            move |scope, input: &Inputs| {
                let (field, values) = scope.parts();
                field
                    .ground
                    .borrow_mut()
                    .root_hold(Some(values.get(&questions.roots)?.values()));
                *target.borrow_mut() = Some(route(field, &p, input).map_err(failure)?);
                Ok(())
            },
        );
        Command::with_inputs(
            "prepare-streams",
            CommandKind::Work,
            dependencies,
            move |scope, work: &StageWork| {
                *prepared.borrow_mut() = None;
                if work.context.hydrology_strength == 0.0 {
                    return Ok(());
                }
                let mut pass = work.context;
                pass.seed ^= work.substep as i32;
                let values = scope.values();
                let input = Inputs {
                    context: pass,
                    discharge: values.get(&questions.passage.discharge)?.values(),
                    withdrawal: values.get(&questions.passage.withdrawal)?.values(),
                    transmission: values.get(&questions.passage.transmission)?.values(),
                };
                scope.run_with_context(&routed, &input, Rc::new(pass))
            },
        )
    }
}
