use super::{city, street, values};
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
    Districts,
    Blocks,
    Circulation,
    Premises,
}
#[derive(Clone, Copy)]
enum Origin {
    Developed,
    Partition,
    Frame,
}
impl Source for Origin {
    type Value = Geometry;
}
#[derive(Clone, Copy)]
enum Boundary {
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
        Origin::Developed,
        Boundary::Approaches,
    ),
    strategy(
        "local-circulation",
        Task::Circulation,
        Origin::Frame,
        Boundary::CityStreets,
    ),
];
const DISTRICTS: &[UrbanStrategy] = &[strategy(
    "district-partition",
    Task::Districts,
    Origin::Partition,
    Boundary::Districts,
)];
const BUILD: &[UrbanStrategy] = &[
    strategy(
        "urban-blocks",
        Task::Blocks,
        Origin::Partition,
        Boundary::Land,
    ),
    strategy("premises", Task::Premises, Origin::Frame, Boundary::Land),
];
type Registration = SemanticRegistration<Task, Origin, Boundary>;
fn owners() -> [Registration; 3] {
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
            "town.movement",
            "Connect urban approaches and occupied frontages",
            &[Product::Travel, Product::CityBlocks],
            &[Product::Roads],
            MOVEMENT,
        ),
        make(
            "town.districts",
            "Partition settled ground into persistent districts",
            &[
                Product::Roads,
                Product::SettlementRecords,
                Product::Layer(crate::human::catalogue::LayerId::Population),
                Product::Layer(crate::human::catalogue::LayerId::BuiltUp),
            ],
            &[Product::Districts],
            DISTRICTS,
        ),
        make(
            "town.construction",
            "Develop serviced blocks and their premises",
            &[
                Product::Roads,
                Product::Districts,
                Product::Layer(crate::human::catalogue::LayerId::BuiltUp),
                Product::Layer(crate::human::catalogue::LayerId::Standing),
            ],
            &[Product::CityBlocks, Product::Premises, Product::OpenSpace],
            BUILD,
        ),
    ]
}
const PUBLICATION: &str = "town.urban-geography";
pub fn publication_specification() -> Specification {
    Specification::new(PUBLICATION, "atlas:workspace", "", true).publication()
}
pub fn specifications() -> Vec<Specification> {
    owners().iter().map(Registration::specification).collect()
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
                let result = (|| -> io::Result<()> {
                    if matches!(input.algorithm, Task::Primary) && urban.domain.is_some() {
                        urban.routes.append(&mut urban.proposed_access);
                        return Ok(());
                    }
                    let Some(domain) = input.initial.bind(|source| match source {
                        Origin::Developed => city::envelope(state),
                        Origin::Partition => Ok(urban.domain.clone()),
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
                        return Ok(());
                    };
                    let boundary = input
                        .boundary
                        .bind(|source| {
                            Ok(Some(match source {
                                Boundary::Approaches => {
                                    let mut roads = super::ground_routes(state)?;
                                    roads.extend(values(state, "thoroughfare")?);
                                    roads
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
                                                || matches!(f.kind.as_str(), "square" | "building"))
                                    })
                                    .cloned()
                                    .collect(),
                                Boundary::Land => super::reservations(state)?,
                            }))
                        })?
                        .unwrap_or_default();
                    match input.algorithm {
                        Task::Primary => city::primary(state, &mut urban, domain, boundary),
                        Task::Districts => city::districts(state, &mut urban, &domain, boundary),
                        Task::Blocks => city::blocks(state, &mut urban, &domain, &boundary),
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
        registry.register(Process::semantic_command(&owner, command, |_, strategy| {
            Ok(strategy)
        }))?;
    }
    if operations.is_some() {
        registry.register(Process::publication(
            publication_specification(),
            crate::publication::urban::publish,
        ))?;
    }
    Ok(())
}
