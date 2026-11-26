use super::{circulation, city, claims, investment, landscape, programs, street, values};
use crate::{
    atlas::{
        dispatch::{Process, Registry, Schedule, SemanticRegistration, Specification},
        state::State,
        town::development::Operations,
    },
    execution::{Command, CommandKind},
    features::Feature,
    processes::strategies::{Absent, Condition, Contract, EffectTime, Product, Source, Strategy},
};
use atlas_map::Geometry;
use std::io;

#[derive(Clone, Copy)]
enum Task {
    Primary,
    Claims,
    Civic(f64),
    Defense,
    Pending,
    Programs(super::character::Settings),
    Districts(f64),
    Landscape(super::activity::Settings),
    Circulation,
    Premises,
}
#[derive(Clone, Copy)]
enum Origin {
    Partition,
    Frame,
}
impl Source for Origin {
    type Value = Geometry;
}
#[derive(Clone, Copy)]
enum Boundary {
    Sponsors,
    Defenses,
    Approaches,
    Districts,
    CityStreets,
    Land,
}
impl Source for Boundary {
    type Value = Vec<Feature>;
}
type UrbanStrategy = Strategy<Task, Origin, Boundary>;
const fn strategy(
    name: &'static str,
    task: Task,
    initial: Origin,
    boundary: Boundary,
) -> UrbanStrategy {
    Strategy {
        name,
        time: EffectTime::Present,
        slot: "urban development",
        algorithm: task,
        initial: Condition::From {
            source: initial,
            absent: Absent::Empty,
        },
        boundary: Condition::From {
            source: boundary,
            absent: Absent::Empty,
        },
    }
}
const MOVEMENT: &[UrbanStrategy] = &[
    strategy(
        "principal-routes",
        Task::Primary,
        Origin::Frame,
        Boundary::Approaches,
    ),
    strategy(
        "local-circulation",
        Task::Circulation,
        Origin::Frame,
        Boundary::CityStreets,
    ),
];
const DISTRICTS: &[UrbanStrategy] = &[
    strategy(
        "district-programs",
        Task::Programs(super::character::Settings::DEFAULT),
        Origin::Frame,
        Boundary::Sponsors,
    ),
    strategy(
        "district-partition",
        Task::Districts(super::partition::CATCHMENT_BOUNDARY.default),
        Origin::Partition,
        Boundary::Districts,
    ),
];
const BUILD: &[UrbanStrategy] = &[
    strategy(
        "urban-blocks",
        Task::Landscape(super::activity::Settings::DEFAULT),
        Origin::Frame,
        Boundary::Land,
    ),
    strategy("premises", Task::Premises, Origin::Frame, Boundary::Land),
];
type Registration = SemanticRegistration<Task, Origin, Boundary>;
const CARRIED: UrbanStrategy = strategy(
    "pending-unassigned",
    Task::Pending,
    Origin::Frame,
    Boundary::Land,
);
const CLAIMS: &[UrbanStrategy] = &[
    strategy(
        "city-area-claims",
        Task::Claims,
        Origin::Frame,
        Boundary::Land,
    ),
    CARRIED,
];
const INVEST: &[UrbanStrategy] = &[
    strategy(
        "civic-precincts",
        Task::Civic(investment::PARCEL_WEIGHT.default),
        Origin::Frame,
        Boundary::Sponsors,
    ),
    strategy(
        "defensive-enclosures",
        Task::Defense,
        Origin::Frame,
        Boundary::Defenses,
    ),
    CARRIED,
];
pub(crate) fn owns(id: &str) -> bool {
    matches!(
        id,
        "town.movement"
            | "town.construction"
            | "town.land-competition"
            | "town.collective-investment"
    )
}
fn owners() -> [Registration; 5] {
    let make = |id, effect, reads, writes, strategies| Registration {
        owner: Contract {
            id,
            catalog_id: id,
            effect,
            reads,
            writes,
            strategies,
        },
        module: "town",
        schedule: Schedule::default(),
        requires: "atlas:workspace",
        produces: "",
    };
    [
        make(
            "town.land-competition",
            "Resolve competing area claims",
            &[
                Product::DistrictPrograms,
                Product::SettledOutline,
                Product::CityAccess,
                Product::OccupiedFrontage,
                Product::CivicPrecincts,
            ],
            &[Product::LandClaims],
            CLAIMS,
        ),
        make(
            "town.collective-investment",
            "Commit supported public and defensive works",
            &[
                Product::DistrictPrograms,
                Product::LandClaims,
                Product::SettlementRecords,
                Product::CityAccess,
            ],
            &[Product::CivicPrecincts, Product::DefenseWorks],
            INVEST,
        ),
        make(
            "town.movement",
            "Connect urban approaches and occupied frontages",
            &[
                Product::Travel,
                Product::LandClaims,
                Product::CivicPrecincts,
                Product::DefenseWorks,
                Product::CityBlocks,
                Product::DistrictPrograms,
                Product::SettledOutline,
                Product::OccupiedFrontage,
            ],
            &[Product::Roads, Product::CityAccess],
            MOVEMENT,
        ),
        make(
            "town.districts",
            "Form district programs, then partition developed urban ground around them",
            &[
                Product::Roads,
                Product::CityAccess,
                Product::OccupiedFrontage,
                Product::SettlementRecords,
                Product::Layer(crate::human::catalogue::LayerId::Population),
                Product::Layer(crate::human::catalogue::LayerId::BuiltUp),
            ],
            &[Product::Districts, Product::DistrictPrograms],
            DISTRICTS,
        ),
        make(
            "town.construction",
            "Develop occupied ground and realize commissioned works or street premises",
            &[
                Product::Roads,
                Product::DistrictPrograms,
                Product::SettledOutline,
                Product::LandClaims,
                Product::CivicPrecincts,
                Product::DefenseWorks,
                Product::CityAccess,
                Product::Layer(crate::human::catalogue::LayerId::BuiltUp),
                Product::Layer(crate::human::catalogue::LayerId::Standing),
            ],
            &[
                Product::UrbanGround,
                Product::Premises,
                Product::OpenSpace,
                Product::OccupiedFrontage,
            ],
            BUILD,
        ),
    ]
}
const PUBLICATION: &str = "town.urban-geography";
pub fn publication_specification() -> Specification {
    Specification::new(PUBLICATION, "atlas:workspace", "", true).publication()
}
pub fn specifications() -> Vec<Specification> {
    owners()
        .iter()
        .map(|o| o.specification().numeric(controls(o.owner.id)))
        .collect()
}
fn controls(id: &str) -> &'static [crate::parameters::NumericParameter] {
    match id {
        "town.districts" => super::character::CONTROLS,
        "town.construction" => super::activity::CONTROLS,
        "town.collective-investment" => &[investment::PARCEL_WEIGHT],
        _ => &[],
    }
}
pub fn register(
    registry: &mut Registry,
    operations: Option<&Operations>,
    district_catchment_scale: f64,
) -> io::Result<()> {
    for owner in owners() {
        let id = owner.owner.id;
        let standalone = operations
            .and_then(|o| o.steps.iter().find(|(name, _)| *name == id))
            .map(|(_, command)| command.clone());
        let command = Command::with_inputs(
            id,
            CommandKind::Work,
            vec![],
            move |scope, input: &UrbanStrategy| {
                if matches!(input.algorithm, Task::Pending) {
                    if let Some(op) = &standalone {
                        scope.run(op, &())?;
                    }
                    return Ok(());
                }
                let state: &mut State = scope.state_mut();
                if matches!(input.algorithm, Task::Circulation | Task::Premises)
                    && !state
                        .regional
                        .as_ref()
                        .is_some_and(|r| r.city.urban.district_child)
                {
                    if let Some(operation) = &standalone {
                        scope.run(operation, &())?;
                    }
                    return Ok(());
                }
                let Some(region) = state.regional.as_mut() else {
                    return Ok(());
                };
                let mut urban = std::mem::take(&mut region.city.urban);
                let round = region.round;
                let result = (|| -> io::Result<()> {
                    let Some(domain) = input.initial.bind(|source| match source {
                        Origin::Partition => Ok(urban
                            .domain
                            .clone()
                            .or_else(|| state.scope.outline.clone())
                            .or_else(|| Some(state.scope.footprint.clone()))),
                        Origin::Frame => Ok(Some(
                            state
                                .scope
                                .outline
                                .as_ref()
                                .unwrap_or(&state.scope.footprint)
                                .clone(),
                        )),
                    })?
                    else {
                        urban.fields = Default::default();
                        return Ok(());
                    };
                    let boundary = input
                        .boundary
                        .bind(|source| {
                            Ok(Some(match source {
                                Boundary::Approaches => {
                                    let mut roads = super::ground_routes(state)?;
                                    if roads.is_empty() {
                                        roads.extend(values(state, "road")?);
                                    }
                                    roads.extend(values(state, "thoroughfare")?);
                                    roads
                                }
                                Boundary::Sponsors => {
                                    let mut sponsors = values(state, "institution")?;
                                    sponsors.extend(values(state, "majorWork")?);
                                    sponsors
                                }
                                Boundary::Defenses => {
                                    let mut works = values(state, "cityWall")?;
                                    works.extend(values(state, "cityGate")?);
                                    works
                                }
                                Boundary::Districts => values(state, "district")?,
                                Boundary::CityStreets => urban
                                    .captured
                                    .iter()
                                    .filter(|f| f.kind == "thoroughfare")
                                    .cloned()
                                    .collect(),
                                Boundary::Land if urban.district_child => urban
                                    .captured
                                    .iter()
                                    .filter(|f| {
                                        f.kind != "district"
                                            && (f.protected
                                                || matches!(
                                                    f.kind.as_str(),
                                                    "square" | "park" | "building"
                                                ))
                                    })
                                    .cloned()
                                    .collect(),
                                Boundary::Land => super::reservations(state)?,
                            }))
                        })?
                        .unwrap_or_default();
                    match input.algorithm {
                        Task::Pending => unreachable!(),
                        Task::Claims => claims::resolve(state, &mut urban, &domain, &boundary),
                        Task::Civic(weight) => {
                            investment::civic(state, &mut urban, &domain, boundary, weight)
                        }
                        Task::Defense => investment::defense(state, &mut urban, &domain, boundary),
                        Task::Primary if urban.layout_round == Some(round) => {
                            circulation::crossings(state, &urban)
                        }
                        Task::Primary => {
                            circulation::routes(state, &mut urban, &domain, boundary)?;
                            urban.layout_round = Some(round);
                            Ok(())
                        }
                        Task::Programs(settings) => programs::compete(
                            state,
                            &mut urban,
                            boundary,
                            district_catchment_scale,
                            settings,
                        ),
                        Task::Districts(weight) => {
                            city::districts(state, &mut urban, boundary, weight)
                        }
                        Task::Landscape(settings) => {
                            landscape::develop(state, &mut urban, &domain, &boundary, settings)
                        }
                        Task::Circulation => street::circulation(
                            state,
                            &mut urban,
                            &domain,
                            &boundary.into_iter().map(|f| f.geometry).collect::<Vec<_>>(),
                        ),
                        Task::Premises => street::premises(state, &mut urban, &domain, &boundary),
                    }
                })();
                state.regional.as_mut().unwrap().city.urban = urban;
                result?;
                Ok(())
            },
        );
        registry.register(
            Process::semantic_command(&owner, command, |input, mut strategy| {
                if matches!(strategy.algorithm, Task::Programs(_)) {
                    strategy.algorithm =
                        Task::Programs(super::character::Settings::from_input(input)?);
                }
                if matches!(strategy.algorithm, Task::Landscape(_)) {
                    strategy.algorithm =
                        Task::Landscape(super::activity::Settings::from_input(input)?);
                }
                if matches!(strategy.algorithm, Task::Districts(_)) {
                    strategy.algorithm =
                        Task::Districts(input.number(super::partition::CATCHMENT_BOUNDARY.name)?);
                }
                if matches!(strategy.algorithm, Task::Civic(_)) {
                    strategy.algorithm = Task::Civic(input.number(investment::PARCEL_WEIGHT.name)?);
                }
                Ok(strategy)
            })
            .numeric(controls(id)),
        )?;
    }
    if operations.is_some() {
        registry.register(Process::publication(
            publication_specification(),
            crate::publication::urban::publish,
        ))?;
    }
    Ok(())
}
