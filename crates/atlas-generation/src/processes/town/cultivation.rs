use crate::{
    atlas::{
        dispatch::{Process, Registry, Schedule, SemanticRegistration},
        state::State,
        town::site,
    },
    execution::{Command, CommandKind},
    human::catalogue::LayerId,
    processes::strategies::{Absent, Condition, Contract, EffectTime, Product, Source, Strategy},
    town::{geometry::Point, ground::Ground, land},
};
use std::io;

#[derive(Clone, Copy)]
pub(crate) struct WorkedGround;
impl Source for WorkedGround {
    type Value = ([f64; 4], Ground);
}

#[derive(Clone, Copy)]
pub(crate) struct AccessWays;
impl Source for AccessWays {
    type Value = Vec<(Vec<Point>, f64)>;
}

type Cultivation = Strategy<(), WorkedGround, AccessWays>;
const HOLDINGS: Cultivation = Strategy {
    name: "local-holdings",
    time: EffectTime::Present,
    slot: "town development",
    algorithm: (),
    initial: Condition::From {
        source: WorkedGround,
        absent: Absent::Error("Cultivation needs working ground"),
    },
    boundary: Condition::From {
        source: AccessWays,
        absent: Absent::Empty,
    },
};

pub(crate) fn owner() -> SemanticRegistration<(), WorkedGround, AccessWays> {
    SemanticRegistration {
        owner: Contract {
            id: "town.cultivation",
            catalog_id: "town.cultivation",
            effect: "Fit worked fields and pastures to available land and reachable farms",
            reads: &[
                Product::Layer(LayerId::Farmland),
                Product::Layer(LayerId::Pasture),
                Product::Premises,
                Product::OpenSpace,
                Product::Roads,
            ],
            writes: &[Product::LandClaims],
            strategies: &[
                HOLDINGS,
                Strategy {
                    name: "pending-unassigned",
                    ..HOLDINGS
                },
            ],
        },
        module: "town",
        schedule: Schedule::default(),
        requires: "atlas:workspace",
        produces: "",
    }
}

pub(crate) fn register(registry: &mut Registry) -> io::Result<()> {
    let owner = owner();
    let command = Command::with_inputs(
        owner.owner.id,
        CommandKind::Work,
        vec![],
        |scope, strategy: &Cultivation| {
            let state: &mut State = scope.state_mut();
            let Some((bounds, ground)) = strategy.initial.bind(|WorkedGround| {
                let bounds = site::bounds(state)?;
                Ok(Some((bounds, site::terrain(state, bounds)?)))
            })?
            else {
                return Ok(());
            };
            let ways = strategy
                .boundary
                .bind(|AccessWays| {
                    site::ways(
                        state.records.features.as_ref(),
                        Some(state.scope.area),
                        state.town.scale(),
                    )
                    .map(Some)
                })?
                .unwrap_or_default();
            if state.town.fields.is_empty() && state.town.fallow.is_empty() {
                let traces = ways
                    .iter()
                    .map(|(points, _)| crate::town::edits::line(points))
                    .chain(state.town.towns.iter().flat_map(|town| {
                        town.streets()
                            .iter()
                            .map(|street| crate::town::edits::line(&street.points))
                    }))
                    .collect::<Vec<_>>();
                state.town.fields = land::establish(
                    bounds,
                    &traces,
                    &state.scope.area.to_string(),
                    |p| site::shares(state.field(), p),
                    state.spatial.as_ref(),
                    state.town.scale(),
                )?;
            }
            land::develop(&mut state.town, &ways, &ground, state.spatial.as_ref())?;
            Ok(())
        },
    );
    registry.register(Process::semantic_command(&owner, command, |_, selected| {
        Ok(selected)
    }))
}
