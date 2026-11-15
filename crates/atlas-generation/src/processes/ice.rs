// Arconis: docs/architecture/subsystems.arconis#item=c_ice — glaciers wear the bed they move over.
use super::runner::{io_error, PhysicalContext};
use crate::{
    answers::AnswerBand,
    execution::{Command, CommandKind, ExecutionError, Query},
    field::{
        glaciers::{
            surface::{self, Surface},
            Settings,
        },
        shared::{CellCode as C, Flag},
        Field,
    },
    rock::{catalogue, ModeId, ModeMix},
    settlement::{
        stage::{SurfaceAction, WearCause},
        Sharing,
    },
};
use std::rc::Rc;
pub fn process(
    settings: Rc<Settings>,
    bite: Query<Field, AnswerBand>,
    roots: Query<Field, AnswerBand>,
) -> Command<Field, PhysicalContext> {
    let p = settings.clone();
    let mix = catalogue::compile(
        ModeMix::default()
            .with(ModeId::Plucking, 0.7)
            .with(ModeId::Abrasion, 0.3),
    );
    let cause = WearCause {
        id: "ice".into(),
        remembers: "CumulativeGlacialErosion".into(),
        past_base_level: true,
    };
    let stage = Field::stage_command_with_roots(
        "ice",
        CommandKind::Work,
        vec![bite.dependency()],
        Sharing::Sequential,
        Some(roots),
        move |stage, c: &PhysicalContext, values| {
            let bite = values.get(&bite).map_err(io_error)?.values();
            let surface = Surface::new(
                stage.ground().read(),
                stage.ground().shared(),
                stage.ground().water(),
            );
            let grounded = stage.ground().shared().flag(Flag::GroundedIce);
            let targets = stage.ground().shared().code(C::IceFlowTargets);
            for cell in 0..stage.mesh().len() {
                if c.glaciation_strength == 0.0 || grounded.get(cell)? == 0 {
                    continue;
                }
                let speed = surface.speed(cell, stage.mesh().spacing())?;
                if speed <= p.glacier_frozen_speed {
                    continue;
                }
                let direction = if let Ok(target) = usize::try_from(targets.get(cell)?) {
                    let from = stage.mesh().position(cell);
                    let to = stage.mesh().position(target);
                    [stage.mesh().delta_x(to[0] - from[0]), to[1] - from[1]]
                } else {
                    [0.0; 2]
                };
                stage.attack(
                    &cause,
                    SurfaceAction {
                        cell,
                        mix: &mix,
                        power: speed * p.glacial_cut_per_speed * c.span * c.glaciation_strength
                            / 1000.0
                            * bite.get(cell)?,
                        limit: surface.can_cut(cell, &p)?,
                        direction,
                    },
                )?;
            }
            Ok(())
        },
    );
    Command::with_inputs("ice", CommandKind::Work, vec![], move |scope, context| {
        scope.run(&stage, context)?;
        surface::refresh(scope.state_mut(), &settings)
            .map_err(|error| ExecutionError::Failed(error.to_string()))
    })
}
