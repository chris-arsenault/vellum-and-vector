//! Real-scale ground detail (ADR 0016, `processes/ground`): each step is a registered command
//! on the common process interface, run only by the real-scale sequence.
use super::super::{Process, Registry, Schedule, SemanticRegistration, Specification};
use crate::{
    atlas::state::State,
    execution::{Command, CommandKind},
    features::{line_profile::Piece, Feature},
    field::poi::contract::TrailRole,
    processes::strategies::{Absent, Condition, Contract, EffectTime, Product, Source, Strategy},
};
use std::io;

type Step = fn(&mut State) -> io::Result<()>;
/// The steps in the order the real-scale sequence runs them, with what each does.
const STEPS: [(&str, Step); 3] = [
    // Pools on the drawn channels, which the water model sized at their real width, through
    // the place catalogue.
    ("real-scale.pools", State::publish_pools),
    // Exposed rock and cliffs.
    ("real-scale.rock", State::publish_exposed_rock),
    // Single plants and stones on maps fine enough to show them.
    ("real-scale.cover", State::scatter_cover),
];
#[derive(Clone, Copy)]
pub(crate) struct ExistingWays;
impl Source for ExistingWays {
    type Value = Vec<(Feature, Vec<Piece>)>;
}
#[derive(Clone, Copy)]
pub(crate) struct WalkingPlaces;
impl Source for WalkingPlaces {
    type Value = Vec<(Feature, TrailRole)>;
}
#[derive(Clone, Copy)]
pub(crate) struct Channels;
impl Source for Channels {
    type Value = Vec<crate::atlas::state::real_scale_water::Drawn>;
}
pub(crate) type RouteStrategy<S> = Strategy<(), S, ExistingWays>;
const fn routes<S: Source>(name: &'static str, source: S) -> RouteStrategy<S> {
    Strategy {
        name,
        time: EffectTime::Present,
        slot: "real-scale ground",
        initial: Condition::From {
            source,
            absent: Absent::Empty,
        },
        boundary: Condition::From {
            source: ExistingWays,
            absent: Absent::Empty,
        },
        algorithm: (),
    }
}
const TRAILS: &[RouteStrategy<WalkingPlaces>] = &[
    routes("local-footpaths", WalkingPlaces),
    routes("pending-unassigned", WalkingPlaces),
];
const CROSSINGS: &[RouteStrategy<Channels>] = &[
    routes("crossing-realization", Channels),
    routes("pending-unassigned", Channels),
];
fn owner<S: Source>(
    id: &'static str,
    effect: &'static str,
    reads: &'static [Product],
    writes: &'static [Product],
    strategies: &'static [RouteStrategy<S>],
) -> SemanticRegistration<(), S, ExistingWays> {
    SemanticRegistration {
        owner: Contract {
            id,
            catalog_id: id,
            effect,
            reads,
            writes,
            strategies,
        },
        module: "ground",
        schedule: Schedule::default(),
        requires: "atlas:workspace",
        produces: "",
    }
}
fn trails() -> SemanticRegistration<(), WalkingPlaces, ExistingWays> {
    owner(
        "real-scale.trails",
        "Connect unserved walking destinations to the available ways",
        &[
            Product::Roads,
            Product::SettlementRecords,
            Product::GroundHazards,
        ],
        &[Product::Roads],
        TRAILS,
    )
}
fn crossings() -> SemanticRegistration<(), Channels, ExistingWays> {
    owner(
        "real-scale.crossings",
        "Resolve surveyed fords and supported bridge spans",
        &[Product::Roads, Product::GroundHazards],
        &[Product::TravelLinks],
        CROSSINGS,
    )
}
pub fn specifications() -> Vec<Specification> {
    let mut specifications: Vec<_> = STEPS
        .iter()
        .map(|(id, _)| Specification::new(id, "atlas:workspace", "", false))
        .collect();
    for mut route in [trails().specification(), crossings().specification()] {
        route.workspace_only = false;
        specifications.push(route);
    }
    specifications
}
pub fn register(registry: &mut Registry) -> io::Result<()> {
    for (id, step) in STEPS {
        let command =
            Command::with_inputs(id, CommandKind::Publish, vec![], move |scope, _: &()| {
                step(scope.state_mut())?;
                Ok(())
            });
        registry.register(Process::unit(
            Specification::new(id, "atlas:workspace", "", false),
            command,
        ))?;
    }
    register_routes(registry, trails(), State::lay_trails)?;
    register_routes(registry, crossings(), State::publish_crossings)
}

fn register_routes<S: Copy + Source + 'static>(
    registry: &mut Registry,
    owner: SemanticRegistration<(), S, ExistingWays>,
    run: fn(&mut State, &RouteStrategy<S>) -> io::Result<()>,
) -> io::Result<()> {
    let command = Command::with_inputs(
        owner.owner.id,
        CommandKind::Work,
        vec![],
        move |scope, strategy| {
            run(scope.state_mut(), strategy)?;
            Ok(())
        },
    );
    let mut process = Process::semantic_command(&owner, command, |_, strategy| Ok(strategy));
    process.specification.workspace_only = false;
    registry.register(process)
}
