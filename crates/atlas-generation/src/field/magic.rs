//! Material magic runs through the same field owners as physical and human work.
use super::{
    shared::{CellCode, Scalar, SharedFields},
    Field,
};
use crate::{
    execution::{Command, CommandKind},
    magic::{
        feedback,
        sources::Environment,
        stocks::{self, run},
        weather,
        workspace::{Loads, Reaction, Workspace},
    },
    storage::{Band, Coverage, ReadBand},
    water::Water,
};
use std::{
    cell::{RefCell, RefMut},
    io,
};
pub mod current;
pub mod initialization;
pub mod supply;

/// Field-owned access used inside magic algorithms. Construction stays with the field;
/// a current query exposes only its completed result, never this writer capability.
enum ChannelAccess<'a> {
    Material(&'a mut SharedFields),
    Current(&'a SharedFields),
}
pub struct Channels<'a>(ChannelAccess<'a>);
pub struct ChannelWrite<'a, T: crate::storage::Sample>(RefMut<'a, Band<T>>);
impl<T: crate::storage::Sample> ChannelWrite<'_, T> {
    pub fn get(&self, cell: usize) -> io::Result<T> {
        self.0.get(cell)
    }
    pub fn set(&mut self, cell: usize, value: T) -> io::Result<()> {
        self.0.set(cell, value)
    }
}
impl Channels<'_> {
    fn read(&self) -> &SharedFields {
        match &self.0 {
            ChannelAccess::Material(fields) => fields,
            ChannelAccess::Current(fields) => fields,
        }
    }
    pub fn material(&mut self) -> io::Result<&mut SharedFields> {
        match &mut self.0 {
            ChannelAccess::Material(fields) => Ok(fields),
            ChannelAccess::Current(_) => Err(io::Error::other(
                "Current magic queries have no material field writer",
            )),
        }
    }
    pub fn scalar(&self, band: Scalar) -> ReadBand<f64> {
        self.read().scalar(band)
    }
    pub fn code(&self, band: CellCode) -> ReadBand<i32> {
        self.read().code(band)
    }
    pub fn scalar_mut(&mut self, band: Scalar) -> ChannelWrite<'_, f64> {
        ChannelWrite(self.read().derive_scalar(band))
    }
    pub fn code_mut(&mut self, band: CellCode) -> ChannelWrite<'_, i32> {
        ChannelWrite(self.read().derive_code(band))
    }
}

pub type WorkspaceInput<'a> = RefCell<&'a mut Workspace>;
pub struct Response<'a> {
    pub workspace: WorkspaceInput<'a>,
    pub seed: i32,
    pub phase: i32,
    pub span: f64,
    pub weather: &'a weather::Settings,
}
pub struct RockResponse<'a> {
    pub workspace: WorkspaceInput<'a>,
    pub floor: f64,
}
pub struct History<'a> {
    pub workspace: WorkspaceInput<'a>,
    pub epoch: i32,
    pub records: RefCell<Vec<feedback::history::Record>>,
}
pub struct Elapsed<'a> {
    pub workspace: WorkspaceInput<'a>,
    pub seed: i32,
    pub span: f64,
}
impl Field {
    fn with_magic<T>(
        &mut self,
        run: impl FnOnce(
            &mut Environment<'_>,
            &mut Water,
            &mut Coverage,
            Loads<'_>,
            &mut crate::human::HumanLayers,
        ) -> io::Result<T>,
    ) -> io::Result<T> {
        let mut water = self.water.borrow_mut();
        let view = water.read_only();
        let mut ground = self.ground.borrow_mut();
        let mut environment = Environment {
            mesh: &self.mesh,
            scale: &self.scale,
            fields: Channels(ChannelAccess::Material(&mut self.shared)),
            ground: &mut ground,
            water: &view,
            events: &self.events,
        };
        run(
            &mut environment,
            &mut water,
            &mut self.coverage.borrow_mut(),
            Loads {
                ground: &mut self.ground_load,
                sea: &mut self.sea_load,
            },
            &mut self.people,
        )
    }
}
pub fn react<'a>() -> Command<Field, Response<'a>> {
    Command::with_inputs(
        "magic.material-response",
        CommandKind::Work,
        vec![],
        |scope, input: &Response<'_>| {
            if input.span <= 0.0 {
                return Ok(());
            }
            scope
                .state_mut()
                .with_magic(|env, water, coverage, loads, _| {
                    input.workspace.borrow_mut().react(
                        env,
                        water,
                        &mut Reaction {
                            seed: input.seed,
                            phase: input.phase,
                            span: input.span,
                            weather: input.weather,
                            load: loads.ground,
                            sea: loads.sea,
                        },
                        coverage,
                    )
                })?;
            Ok(())
        },
    )
}
pub fn elapsed_forcing<'a>() -> Command<Field, Elapsed<'a>> {
    Command::with_inputs(
        "magic.elapsed-forcing",
        CommandKind::Work,
        vec![],
        |scope, input: &Elapsed<'_>| {
            if input.span <= 0.0 {
                return Ok(());
            }
            scope.state_mut().with_magic(|env, water, coverage, _, _| {
                input
                    .workspace
                    .borrow_mut()
                    .shared_forcing(env, water, input.span, coverage)
            })?;
            Ok(())
        },
    )
}
pub fn post_glacial_cover<'a>() -> Command<Field, Elapsed<'a>> {
    Command::with_inputs(
        "magic.post-glacial-cover",
        CommandKind::Work,
        vec![],
        |scope, input: &Elapsed<'_>| {
            scope.state_mut().with_magic(|env, water, coverage, _, _| {
                let mut workspace = input.workspace.borrow_mut();
                let Workspace { fields, rims, .. } = &mut **workspace;
                if input.span > 0.0 {
                    feedback::living(env, fields, &water.river_reader(), true, rims, coverage)?;
                }
                crate::magic::regions::cover_systems(env, fields, input.seed, coverage)
            })?;
            Ok(())
        },
    )
}
pub fn rocks<'a>() -> Command<Field, RockResponse<'a>> {
    Command::with_inputs(
        "magic.rocks",
        CommandKind::Work,
        vec![],
        |scope, input: &RockResponse<'_>| {
            scope.state_mut().with_magic(|env, _, _, _, _| {
                feedback::rock::feedback(env, &mut input.workspace.borrow_mut().fields, input.floor)
            })?;
            Ok(())
        },
    )
}
pub fn exchange_water<'a>() -> Command<Field, WorkspaceInput<'a>> {
    Command::with_inputs(
        "magic.water-exchange",
        CommandKind::Work,
        vec![],
        |scope, input: &WorkspaceInput<'_>| {
            scope.state_mut().with_magic(|env, _, coverage, _, _| {
                run::exchange_water(env, &mut input.borrow_mut().fields, coverage)
            })?;
            Ok(())
        },
    )
}
pub fn advect<'a>() -> Command<Field, WorkspaceInput<'a>> {
    Command::with_inputs(
        "magic.carry-crust",
        CommandKind::Event,
        vec![],
        |scope, input: &WorkspaceInput<'_>| {
            let field = scope.state_mut();
            let dominant = field.shared.code(CellCode::AdvectionSourceIndex);
            let history = field.transport_plan.as_ref().map(|plan| plan.history());
            for magic in &mut input.borrow_mut().fields {
                magic.advect(
                    &dominant,
                    history.as_ref().map(|history| &history.shares),
                    field.coverage.get_mut(),
                )?;
            }
            Ok(())
        },
    )
}
pub fn respond_organic<'a>() -> Command<Field, WorkspaceInput<'a>> {
    Command::with_inputs(
        "magic.organic-material",
        CommandKind::Work,
        vec![],
        |scope, input: &WorkspaceInput<'_>| {
            scope.state_mut().with_magic(|env, water, _, loads, _| {
                run::respond_organic(
                    env,
                    &mut input.borrow_mut().fields,
                    &water.river_reader(),
                    loads.ground,
                )
            })?;
            Ok(())
        },
    )
}
pub fn transport<'a>() -> Command<Field, WorkspaceInput<'a>> {
    Command::with_inputs(
        "magic.transport-retained",
        CommandKind::Work,
        vec![],
        |scope, input: &WorkspaceInput<'_>| {
            scope
                .state_mut()
                .with_magic(|env, water, coverage, loads, _| {
                    let mut workspace = input.borrow_mut();
                    let Workspace {
                        fields,
                        carrier_costs,
                        ..
                    } = &mut **workspace;
                    run::transport_retained(
                        env,
                        fields,
                        &mut run::Carriage {
                            transport: stocks::Transport {
                                coverage,
                                sea: loads.sea,
                                costs: carrier_costs,
                            },
                            rivers: &water.river_reader(),
                            load: loads.ground,
                        },
                    )
                })?;
            Ok(())
        },
    )
}
pub fn retain_history<'a>() -> Command<Field, History<'a>> {
    Command::with_inputs(
        "magic.retain-history",
        CommandKind::Event,
        vec![],
        |scope, input: &History<'_>| {
            *input.records.borrow_mut() =
                scope
                    .state_mut()
                    .with_magic(|env, water, coverage, loads, _| {
                        input.workspace.borrow_mut().retain_history(
                            env,
                            water,
                            input.epoch,
                            loads,
                            coverage,
                        )
                    })?;
            Ok(())
        },
    )
}
