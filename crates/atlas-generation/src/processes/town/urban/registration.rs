use super::{circulation, city, claims, investment, landscape, programs, values};
use crate::town::{ground::Ground, influence::SiteConditions};
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
use std::rc::Rc;

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
    Livelihood,
    Premises,
    Parcels,
    Commons,
}
#[derive(Clone, Copy)]
enum Origin {
    Partition,
    Frame,
    OccupiedGround,
}
impl Source for Origin {
    type Value = Evidence<Geometry, Rc<Ground>>;
}
#[derive(Clone, Copy)]
enum Boundary {
    Sponsors,
    Defenses,
    Approaches,
    Districts,
    Land,
    LocalConditions,
}
impl Source for Boundary {
    type Value = Evidence<Vec<Feature>, Rc<SiteConditions>>;
}
enum Evidence<C, S> {
    City(C),
    Street(S),
}
/// The town operations use their cached walking ground and the sampled conditions at
/// each holding and proposed frontage. City operations request their own GIS inputs.
#[derive(Clone, Copy)]
pub(crate) struct LocalInputs {
    initial: Condition<Origin>,
    boundary: Condition<Boundary>,
}
impl LocalInputs {
    pub(crate) const TOWN: Self = Self {
        initial: Condition::From {
            source: Origin::OccupiedGround,
            absent: Absent::Error("Town development needs walking ground"),
        },
        boundary: Condition::From {
            source: Boundary::LocalConditions,
            absent: Absent::Error("Town development needs site conditions"),
        },
    };
    pub(crate) fn ground(
        self,
        read: impl FnOnce() -> io::Result<Rc<Ground>>,
    ) -> io::Result<Rc<Ground>> {
        match self.initial.bind(|source| match source {
            Origin::OccupiedGround => Ok(Some(Evidence::Street(read()?))),
            _ => Err(io::Error::other(
                "City geometry supplied to Street development",
            )),
        })? {
            Some(Evidence::Street(ground)) => Ok(ground),
            _ => Err(io::Error::other("Missing town ground")),
        }
    }
    pub(crate) fn conditions(
        self,
        read: impl FnOnce() -> crate::execution::ExecutionResult<Rc<SiteConditions>>,
    ) -> io::Result<Rc<SiteConditions>> {
        match self.boundary.bind(|source| match source {
            Boundary::LocalConditions => Ok(Some(Evidence::Street(
                read().map_err(|e| io::Error::other(format!("{e:?}")))?,
            ))),
            _ => Err(io::Error::other(
                "City boundary records supplied to Street development",
            )),
        })? {
            Some(Evidence::Street(conditions)) => Ok(conditions),
            _ => Err(io::Error::other("Missing town site conditions")),
        }
    }
}
type UrbanStrategy = Strategy<Task, Origin, Boundary>;
const fn local(name: &'static str, task: Task) -> UrbanStrategy {
    UrbanStrategy {
        name,
        time: EffectTime::Present,
        slot: "town development",
        algorithm: task,
        initial: LocalInputs::TOWN.initial,
        boundary: LocalInputs::TOWN.boundary,
    }
}
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
    local("local-circulation", Task::Circulation),
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
    local("premises", Task::Premises),
];
type Registration = SemanticRegistration<Task, Origin, Boundary>;
const CARRIED: UrbanStrategy = local("pending-unassigned", Task::Pending);
const LIVELIHOOD: &[UrbanStrategy] = &[CARRIED, local("premise-viability", Task::Livelihood)];
const CLAIMS: &[UrbanStrategy] = &[
    CARRIED,
    strategy(
        "city-area-claims",
        Task::Claims,
        Origin::Frame,
        Boundary::Land,
    ),
    local("parcel-claims", Task::Parcels),
];
const INVEST: &[UrbanStrategy] = &[
    CARRIED,
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
    local("local-commons-and-works", Task::Commons),
];
pub(crate) fn owns(id: &str) -> bool {
    matches!(
        id,
        "town.movement"
            | "town.construction"
            | "town.livelihood"
            | "town.land-competition"
            | "town.collective-investment"
    )
}
fn owners() -> [Registration; 6] {
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
            "town.livelihood",
            "Resolve viable occupants, customers and suppliers through local access",
            &[
                Product::Premises,
                Product::Travel,
                Product::OccupiedFrontage,
            ],
            &[Product::Question("town operating ties")],
            LIVELIHOOD,
        ),
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
pub fn register(registry: &mut Registry, operations: Option<&Operations>) -> io::Result<()> {
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
                if matches!(
                    input.algorithm,
                    Task::Pending
                        | Task::Circulation
                        | Task::Livelihood
                        | Task::Premises
                        | Task::Parcels
                        | Task::Commons
                ) {
                    if let Some(op) = &standalone {
                        scope.run(
                            op,
                            &LocalInputs {
                                initial: input.initial,
                                boundary: input.boundary,
                            },
                        )?;
                    } else if !matches!(input.algorithm, Task::Pending) {
                        return Err(
                            io::Error::other(format!("Missing Street operation for {id}")).into(),
                        );
                    }
                    return Ok(());
                }
                let state: &mut State = scope.state_mut();
                let Some(region) = state.regional.as_mut() else {
                    return Ok(());
                };
                let mut urban = std::mem::take(&mut region.city.urban);
                let round = region.round;
                let result = (|| -> io::Result<()> {
                    let Some(Evidence::City(domain)) = input.initial.bind(|source| {
                        Ok(match source {
                            Origin::Partition => urban
                                .domain
                                .clone()
                                .or_else(|| state.scope.outline.clone())
                                .or_else(|| Some(state.scope.footprint.clone())),
                            Origin::Frame => Some(
                                state
                                    .scope
                                    .outline
                                    .as_ref()
                                    .unwrap_or(&state.scope.footprint)
                                    .clone(),
                            ),
                            Origin::OccupiedGround => {
                                return Err(io::Error::other(
                                    "Street walking ground in City process",
                                ))
                            }
                        }
                        .map(Evidence::City))
                    })?
                    else {
                        urban.fields = Default::default();
                        return Ok(());
                    };
                    let Some(Evidence::City(boundary)) = input.boundary.bind(|source| {
                        Ok(Some(Evidence::City(match source {
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
                            Boundary::Land => super::reservations(state)?,
                            Boundary::LocalConditions => {
                                return Err(io::Error::other(
                                    "Street site conditions in City process",
                                ))
                            }
                        })))
                    })?
                    else {
                        return Ok(());
                    };
                    match input.algorithm {
                        Task::Pending
                        | Task::Circulation
                        | Task::Livelihood
                        | Task::Premises
                        | Task::Parcels
                        | Task::Commons => unreachable!(),
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
                            settings.catchment,
                            settings,
                        ),
                        Task::Districts(weight) => {
                            city::districts(state, &mut urban, boundary, weight)
                        }
                        Task::Landscape(settings) => {
                            landscape::develop(state, &mut urban, &domain, &boundary, settings)
                        }
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
