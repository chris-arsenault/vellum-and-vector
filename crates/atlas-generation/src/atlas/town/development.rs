//! Binds pure settlement mechanisms to current field answers, source providers and owner commands.
use super::{site, Settings};
use crate::town::catalogue::PlaceRules;
use crate::{
    atlas::{physical::Physical, state::State},
    execution::{Command, CommandKind, Projection, Query},
    field::{
        refinement::{courses::cell_at, people},
        shared::Scalar,
        Field,
    },
    processes::town::{self as processes, Candidate, Mechanism},
    town::{
        access::Access,
        fabric::Town,
        geometry::Point,
        ground::{FIRST_STREET, PLOT},
        influence::{Conditions, Opportunities, Reachable, SiteConditions},
        plots::{slots, Slot},
    },
};
use std::{io, rc::Rc};
pub struct EnvironmentAnswers {
    travel: crate::storage::ReadBand<f64>,
    building: crate::storage::ReadBand<f64>,
    harm: crate::storage::ReadBand<f64>,
    yielding: crate::storage::ReadBand<f64>,
    forgetting: crate::storage::ReadBand<f64>,
    presence: crate::storage::ReadBand<f64>,
}
impl crate::execution::QueryValue for EnvironmentAnswers {}
pub struct SiteRequests(
    pub Vec<Vec<Point>>,
    pub Rc<EnvironmentAnswers>,
    pub Rc<crate::town::ground::Ground>,
);

/// Long inter-settlement ways can cross empty land. New frontage is occupied
/// from existing premises, the settlement origin or a working destination.
fn inhabited_frontage(
    town: &Town,
    candidates: Vec<Slot>,
    sources: &[crate::town::influence::OpportunitySource],
    spatial: &dyn crate::spatial::SpatialKernel,
) -> io::Result<Vec<Slot>> {
    use atlas_map::{Geometry, Position};
    let point = |[x, y]: Point| Geometry::Point {
        coordinates: Position::xy(x, y),
    };
    let mut anchors: Vec<_> = town
        .holdings()
        .iter()
        .filter(|h| h.condition > 0.2)
        .map(|h| h.outline.clone())
        .collect();
    anchors.push(point(town.seat.centre));
    anchors.extend(
        sources
            .iter()
            .filter(|s| {
                matches!(
                    s.endpoint,
                    crate::town::fabric::Endpoint::External(_)
                        | crate::town::fabric::Endpoint::Field(_)
                ) && (s.capability > 0. || s.demand > 0.)
            })
            .map(|s| point(s.position)),
    );
    let index = spatial.index(&anchors).map_err(io::Error::other)?;
    let fronts: Vec<_> = candidates
        .iter()
        .map(|s| Position::xy(s.front[0], s.front[1]))
        .collect();
    let nearest = index.nearest_many(&fronts).map_err(io::Error::other)?;
    let mut available = Vec::new();
    for (slot, anchor) in candidates.into_iter().zip(nearest) {
        if let Some(i) = anchor {
            let gap = spatial
                .distance(&point(slot.front), &anchors[i])
                .map_err(io::Error::other)?;
            if gap <= slot.depth * 2. {
                available.push(slot);
            }
        }
    }
    Ok(available)
}
/// Nearby sites compete on connected buildable land and distance to the captured
/// settlement. A dry ledge cut off by cliffs is a poor substitute for a river valley.
fn habitable_sites(
    state: &State,
    ground: &crate::town::ground::Ground,
    origin: Point,
) -> Vec<(usize, Point)> {
    use crate::town::{geometry::distance, ground::FREE};
    let mesh = state.field().mesh();
    let offset = mesh.origin();
    let points: Vec<_> = (0..mesh.len())
        .map(|cell| {
            let p = mesh.position(cell);
            [p[0] + offset[0], p[1] + offset[1]]
        })
        .collect();
    let mut available: Vec<_> = points.iter().map(|&p| ground.owner(p) == FREE).collect();
    let mut ranked = Vec::new();
    for seed in 0..mesh.len() {
        if !available[seed] {
            continue;
        }
        let mut component = vec![seed];
        available[seed] = false;
        let mut next = 0;
        while next < component.len() {
            let cell = component[next];
            next += 1;
            for other in (0..3).filter_map(|edge| mesh.neighbor(cell, edge)) {
                let leg = [points[cell], points[other]];
                if available[other]
                    && ground.reach(&leg, |mark| mark != FREE) >= distance(leg[0], leg[1])
                {
                    component.push(other);
                    available[other] = false;
                }
            }
        }
        let span = (component.len() as f64).sqrt();
        for cell in component {
            ranked.push((
                (ground.cell + distance(points[cell], origin)) / span,
                cell,
                points[cell],
            ));
        }
    }
    // hpc-exempt: rank alternative locations for a captured named settlement.
    ranked.sort_by(|a, b| a.0.total_cmp(&b.0));
    ranked.into_iter().map(|(_, cell, p)| (cell, p)).collect()
}
fn settle(
    state: &State,
    seat: crate::town::seat::Seat,
    ground: &crate::town::ground::Ground,
    layout: Option<super::story::Layout>,
) -> io::Result<Town> {
    let mesh = state.field().mesh();
    let first = cell_at(mesh, seat.centre)
        .ok_or_else(|| io::Error::other("Founding site outside town ground"))?;
    let fallback = std::iter::once_with(|| habitable_sites(state, ground, seat.centre)).flatten();
    for (_, centre) in std::iter::once((first, seat.centre)).chain(fallback) {
        if ground.owner(centre) != crate::town::ground::FREE {
            continue;
        }
        let mut candidate = seat.clone();
        candidate.centre = centre;
        for arm in &mut candidate.arms {
            arm.points[0] = centre;
        }
        let local = |point| {
            let Some(cell) = cell_at(mesh, point) else {
                return Ok(None);
            };
            Ok(Some(Conditions {
                cultivated: site::worked_shares(state.field(), cell)?.0,
                bank: shore(state.field(), cell, false)?,
                flowing: shore(state.field(), cell, true)?,
                ..Conditions::default()
            }))
        };
        let mut town = Town::new(candidate, layout);
        if crate::town::founding::establish(&mut town, ground, state.spatial.as_ref(), local)? {
            return Ok(town);
        }
    }
    Err(io::Error::other(format!(
        "No habitable founding site for {}",
        seat.name
    )))
}
pub struct Operations {
    pub initialize: Command<State, Settings>,
    pub steps: Vec<(&'static str, Command<State>)>,
    providers: Vec<Query<State, crate::town::influence::Sources>>,
    sources: Query<State, crate::town::influence::Sources>,
    samples: Query<State, SiteConditions>,
    exposure: Query<State, SiteConditions>,
    base: Query<State, SiteConditions>,
    environment: Query<State, EnvironmentAnswers>,
}
fn environment(
    physical: &Physical,
    projection: &Projection<State, Field>,
) -> Query<State, EnvironmentAnswers> {
    let travel = physical.people.friction.projected(projection);
    let building = physical.people.building.projected(projection);
    let harm = physical.people.harm.projected(projection);
    let yielding = physical.people.yielding.projected(projection);
    let forgetting = physical.people.forgetting.projected(projection);
    let presence = physical.people.presence.projected(projection);
    Query::new(
        "town.environment",
        vec![
            travel.dependency(),
            building.dependency(),
            harm.dependency(),
            yielding.dependency(),
            forgetting.dependency(),
            presence.dependency(),
        ],
        move |_, reader| {
            Ok(EnvironmentAnswers {
                travel: reader.get(&travel)?.values(),
                building: reader.get(&building)?.values(),
                harm: reader.get(&harm)?.values(),
                yielding: reader.get(&yielding)?.values(),
                forgetting: reader.get(&forgetting)?.values(),
                presence: reader.get(&presence)?.values(),
            })
        },
    )
}
fn shore(field: &Field, cell: usize, running: bool) -> io::Result<bool> {
    let water = field.water();
    for c in std::iter::once(cell).chain((0..3).filter_map(|e| field.mesh().neighbor(cell, e))) {
        if water.channels.width.get(c)? > 0. && water.channels.depth.get(c)? > 0. {
            return Ok(true);
        }
        if !running && water.column.kind.get(c)? != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}
// owner-direction(2026-11-17): numerical lattice population density, terrain and magic all influence layout.
fn samples() -> Query<State, SiteConditions> {
    Query::new(
        "town.site-conditions",
        vec![],
        move |state: &State, reader| {
            let request = reader.input::<SiteRequests>()?;
            let travel = &request.1.travel;
            let building = &request.1.building;
            let harm = &request.1.harm;
            let field = state.field();
            let slope = field.shared().scalar(Scalar::Slope);
            let waste = field.town_signals().read().map(|(_, b)| b);
            let mut result = Vec::new();
            for points in &request.0 {
                let mut values = Vec::new();
                for point in points {
                    let cell = cell_at(field.mesh(), *point).ok_or_else(|| {
                        io::Error::other("Town site lies outside the map lattice")
                    })?;
                    values.push(Conditions {
                        bank: shore(field, cell, false)?,
                        flowing: shore(field, cell, true)?,
                        craft: crate::field::people::crafts::CRAFTS
                            .iter()
                            .map(|&craft| {
                                Ok((
                                    craft.code,
                                    crate::field::people::crafts::practised(field, craft, cell)?,
                                ))
                            })
                            .collect::<io::Result<Vec<_>>>()?
                            .into_iter()
                            .filter(|(_, share)| *share > 0.)
                            .max_by(|a, b| a.1.total_cmp(&b.1))
                            .map(|(code, _)| code),
                        clearance: 0.,
                        exchange: field
                            .town_signals()
                            .read()
                            .map(|(a, _)| a.get(cell))
                            .transpose()?
                            .unwrap_or(0.),
                        population: field.people().people(cell)?,
                        yielding: request.1.yielding.get(cell)?,
                        forgetting: request.1.forgetting.get(cell)?,
                        presence: request.1.presence.get(cell)?,
                        cultivated: site::worked_shares(field, cell)?.0,
                        rural_service: 0.,
                        density: 0.,
                        slope: slope.get(cell)?,
                        flood: field.water().column.kind.get(cell)? as f64,
                        waste: waste
                            .as_ref()
                            .map(|b| b.get(cell))
                            .transpose()?
                            .unwrap_or(0.),
                        nuisance: 0.,
                        protection: 1. / (1. + harm.get(cell)?.max(0.)),
                        building: building.get(cell)?,
                        travel: travel.get(cell)?.max(0.01),
                        ..Conditions::default()
                    });
                }
                result.push(values)
            }
            Ok(SiteConditions(result))
        },
    )
}
impl Operations {
    pub fn new(physical: &Physical, projection: &Projection<State, Field>) -> Self {
        let providers = vec![
            super::providers::approaches(),
            super::providers::institutions(),
            super::providers::occupation(),
            super::providers::agriculture(),
        ];
        let sources = super::providers::compose(providers.clone());
        let environment = environment(physical, projection);
        let base = samples();
        let exposure = super::providers::use_exposure();
        let extra = exposure.clone();
        let base_read = base.clone();
        let samples = Query::new(
            "town.site-conditions.composed",
            vec![base.dependency(), extra.dependency()],
            move |_, reader| {
                let base = reader.get(&base_read)?;
                let extra = reader.get(&extra)?;
                let values = base
                    .0
                    .iter()
                    .zip(&extra.0)
                    .map(|(a, b)| {
                        a.iter()
                            .zip(b)
                            .map(|(a, b)| Conditions {
                                waste: a.waste,
                                nuisance: a.nuisance + b.nuisance,
                                cultivated: a.cultivated.max(b.cultivated),
                                rural_service: a.rural_service + b.rural_service,
                                patronage: b.patronage,
                                households: b.households,
                                institutions: b.institutions,
                                workshops: b.workshops,
                                density: a.density + b.density,
                                clearance: a.clearance + b.clearance,
                                protection: a.protection + b.protection,
                                ..*a
                            })
                            .collect()
                    })
                    .collect();
                Ok(SiteConditions(values))
            },
        );
        let initialize = Command::with_inputs(
            "town.initialize",
            CommandKind::Initialize,
            vec![],
            |scope, settings: &Settings| {
                let state: &mut State = scope.state_mut();
                if !state.town.towns.is_empty()
                    || !state
                        .regional
                        .as_ref()
                        .is_some_and(|r| people::enabled(&r.domains))
                {
                    return Ok(());
                }
                let site = site::starting(state)?;
                state.town.towns = site
                    .seats
                    .into_iter()
                    .map(|seat| settle(state, seat, &site.ground, settings.layout))
                    .collect::<io::Result<Vec<_>>>()?;
                Ok(())
            },
        );
        let cleanup = Field::town_clearance_operation().projected(projection);
        let mut steps: Vec<_> = processes::STEPS
            .iter()
            .map(|step| {
                let sources = sources.clone();
                let samples = samples.clone();
                let environment = environment.clone();
                let run = step.run;
                let reads = match run {
                    Mechanism::Movement(_) | Mechanism::Frontage(_) => processes::Reads::Frontage,
                    Mechanism::Livelihood(_) => processes::Reads::Livelihood,
                    _ => processes::Reads::Exposure,
                };
                let cleanup = cleanup.clone();
                let mut dependencies = vec![environment.dependency()];
                if reads != processes::Reads::Exposure {
                    dependencies.push(sources.dependency());
                }
                let command = Command::with_inputs(
                    step.id,
                    CommandKind::Work,
                    dependencies,
                    move |scope, _: &()| {
                        let source = if reads == processes::Reads::Exposure {
                            Rc::new(crate::town::influence::Sources(vec![]))
                        } else {
                            scope.query(&sources)?
                        };
                        let environment = scope.query(&environment)?;
                        let walking_ground = Rc::new(site::walking_ground(scope.state())?);
                        let candidates: Vec<Vec<Slot>> = scope
                            .state()
                            .town
                            .towns
                            .iter()
                            .map(|town| {
                                if reads != processes::Reads::Frontage {
                                    return Ok(vec![]);
                                }
                                let sites = town
                                    .streets()
                                    .iter()
                                    .enumerate()
                                    .flat_map(|(i, street)| slots(i, street, 9., 25.))
                                    .chain(crate::town::land_sites::around(
                                        std::iter::once(town.seat.centre).chain(
                                            town.holdings()
                                                .iter()
                                                .filter(|h| h.condition > 0.2)
                                                .map(|h| h.slot.front),
                                        ),
                                        50.,
                                        9.,
                                        25.,
                                        town.round,
                                    ))
                                    .chain(
                                        town.holdings()
                                            .iter()
                                            .flat_map(crate::town::plots::participant_slots),
                                    )
                                    .filter(|s| {
                                        (s.street.is_some()
                                            || s.participant.is_some()
                                            || walking_ground.owner(s.front)
                                                == crate::town::ground::FREE)
                                            && cell_at(scope.state().field().mesh(), s.front)
                                                .is_some()
                                    })
                                    .collect::<Vec<_>>();
                                inhabited_frontage(
                                    town,
                                    sites,
                                    &source.0,
                                    scope.state().spatial.as_ref(),
                                )
                            })
                            .collect::<io::Result<_>>()?;
                        let outlying = scope
                            .state()
                            .town
                            .towns
                            .iter()
                            .map(|town| {
                                if !matches!(run, Mechanism::Movement(_)) {
                                    return Ok(vec![]);
                                }
                                let mut sites = crate::town::founding::outlying_sites(
                                    town,
                                    &source.0,
                                    &walking_ground,
                                    scope.state().spatial.as_ref(),
                                )?;
                                sites.retain(|site| {
                                    site.samples().iter().all(|p| {
                                        cell_at(scope.state().field().mesh(), *p).is_some()
                                    })
                                });
                                Ok::<_, io::Error>(sites)
                            })
                            .collect::<Result<Vec<_>, _>>()?;
                        let requests = Rc::new(SiteRequests(
                            scope
                                .state()
                                .town
                                .towns
                                .iter()
                                .zip(&candidates)
                                .zip(&outlying)
                                .map(|((town, candidates), outlying)| {
                                    town.holdings()
                                        .iter()
                                        .map(|h| h.slot.front)
                                        .chain(candidates.iter().map(|s| s.front))
                                        .chain(outlying.iter().flat_map(|site| site.samples()))
                                        .collect()
                                })
                                .collect(),
                            environment,
                            walking_ground.clone(),
                        ));
                        let conditions = scope.query_with_context(&samples, requests)?;
                        let state = scope.state_mut();
                        let spatial = state.spatial.clone();
                        let origin = state.field().mesh().origin();
                        let links = super::providers::kept_links(state)?
                            .into_iter()
                            .map(|link| {
                                let a = state.field().mesh().position(link.a);
                                let b = state.field().mesh().position(link.b);
                                (
                                    [a[0] + origin[0], a[1] + origin[1]],
                                    [b[0] + origin[0], b[1] + origin[1]],
                                    link.cost,
                                )
                            })
                            .collect::<Vec<_>>();
                        let mut ground = if reads == processes::Reads::Frontage {
                            let mut ground = (*walking_ground).clone();
                            let masks: Vec<_> = state
                                .town
                                .towns
                                .iter()
                                .flat_map(|t| t.holdings().iter().map(|h| h.outline.clone()))
                                .collect();
                            ground.mark_shapes(&masks, PLOT, spatial.as_ref())?;
                            Some(ground)
                        } else {
                            None
                        };
                        let mut removals = Vec::new();
                        for (index, town) in state.town.towns.iter_mut().enumerate() {
                            let costs = if reads != processes::Reads::Frontage {
                                vec![]
                            } else {
                                let mut access = Access::new(town.streets(), spatial.as_ref())?
                                    .on_ground(&walking_ground);
                                for &(a, b, cost) in &links {
                                    access.add_link(a, b, cost, spatial.as_ref())?;
                                }
                                let targets: Vec<_> = town
                                    .holdings()
                                    .iter()
                                    .map(|h| h.slot.front)
                                    .chain(candidates[index].iter().map(|s| s.front))
                                    .collect();
                                let origins: Vec<_> = source.0.iter().map(|s| s.position).collect();
                                access.travel_costs(&origins, &targets, spatial.as_ref())?
                            };
                            let n = town.holdings().len();
                            // hpc-exempt: index the retained counterparties of actual operating premises.
                            let mut customers = std::collections::BTreeMap::new();
                            town.holdings()
                                .iter()
                                .flat_map(|h| {
                                    h.operating_shares().map(move |(t, share)| {
                                        (&t.destination, h.occupation * share)
                                    })
                                })
                                .for_each(|(destination, occupation)| {
                                    *customers.entry(destination).or_insert(0.) += occupation
                                });
                            let proposals = candidates[index]
                                .iter()
                                .enumerate()
                                .map(|(i, slot)| {
                                    let c = conditions.0[index][n + i];
                                    let paths: Vec<_> = source
                                        .0
                                        .iter()
                                        .enumerate()
                                        .map(|(j, source)| Reachable {
                                            source,
                                            cost: costs[j][n + i],
                                            competitors: customers
                                                .get(&source.endpoint)
                                                .copied()
                                                .unwrap_or(0.),
                                        })
                                        .collect();
                                    Candidate {
                                        slot: slot.clone(),
                                        conditions: c,
                                        opportunities: Opportunities::new(&paths, c),
                                    }
                                })
                                .collect::<Vec<_>>();
                            let observations = &conditions.0[index];
                            let outlying: Vec<_> = outlying[index]
                                .iter()
                                .zip(
                                    observations[n + candidates[index].len()..]
                                        .as_chunks::<2>()
                                        .0
                                        .iter()
                                        .copied(),
                                )
                                .collect();
                            let conditions = &observations[..n];
                            let exposure = processes::Exposure {
                                spatial: spatial.as_ref(),
                                conditions,
                                exposure: 1.,
                            };
                            match run {
                                Mechanism::Movement(run) | Mechanism::Frontage(run) => {
                                    let ground = ground.as_mut().ok_or_else(|| {
                                        io::Error::other("Frontage requires site ground")
                                    })?;
                                    for (i, street) in town.streets().iter().enumerate() {
                                        ground.take_street(street, FIRST_STREET + i as u32);
                                    }
                                    run(
                                        town,
                                        &mut processes::Frontage {
                                            walking_ground: &walking_ground,
                                            outlying: &outlying,
                                            links: &links,
                                            ground,
                                            spatial: spatial.as_ref(),
                                            candidates: &proposals,
                                            conditions,
                                            sources: &source.0,
                                            exposure: 1.,
                                        },
                                    )?
                                }
                                Mechanism::Livelihood(run) => run(
                                    town,
                                    &processes::Livelihood {
                                        walking_ground: &walking_ground,
                                        links: &links,
                                        spatial: spatial.as_ref(),
                                        sources: &source.0,
                                        conditions,
                                        exposure: 1.,
                                    },
                                )?,
                                Mechanism::Exposure(run) => run(town, &exposure)?,
                                Mechanism::Clearance(run) => removals.extend(run(town, &exposure)?),
                            }
                            if step.id == "town.maintenance" {
                                town.round += 1;
                            }
                        }
                        let removals = removals
                            .into_iter()
                            .filter_map(|(point, amount)| {
                                cell_at(state.field().mesh(), point).map(|cell| (cell, amount))
                            })
                            .collect::<Vec<_>>();
                        if !removals.is_empty() {
                            scope.run(&cleanup, &removals)?;
                        }
                        Ok(())
                    },
                );
                (step.id, command)
            })
            .collect();
        let pressure =
            Field::town_pressure_operation(physical.people.friction.clone()).projected(projection);
        let pressure: Command<State> = Command::with_inputs(
            "town.signals",
            CommandKind::Work,
            vec![],
            move |scope, _: &()| {
                let field = scope.state().field();
                let mut sources = Vec::new();
                for town in &scope.state().town.towns {
                    for holding in town.holdings() {
                        if let Some(cell) = cell_at(field.mesh(), holding.slot.front) {
                            let activity = holding.occupation * holding.kind.definition().demand;
                            let mut local = activity;
                            for (tie, share) in holding.operating_shares() {
                                if let Some(destination) = cell_at(field.mesh(), tie.entrance) {
                                    let amount = activity * share * 0.5;
                                    sources.push((destination, amount, 0.));
                                    local -= amount;
                                }
                            }
                            sources.push((
                                cell,
                                local,
                                holding.occupation * (0.02 + holding.crowding * 0.1),
                            ));
                        }
                    }
                }
                let links = super::providers::kept_links(scope.state())?;
                scope.run(&pressure, &crate::town::signals::Inputs { sources, links })
            },
        );
        steps.insert(1, ("town.signals", pressure));
        Self {
            initialize,
            steps,
            providers,
            sources,
            samples,
            exposure,
            base,
            environment,
        }
    }
    pub fn select(&self, executor: &mut crate::execution::Executor<State>) {
        for provider in &self.providers {
            executor.select(provider);
        }
        executor.select(&self.sources);
        executor.select(&self.samples);
        executor.select(&self.exposure);
        executor.select(&self.base);
        executor.select(&self.environment);
    }
}
