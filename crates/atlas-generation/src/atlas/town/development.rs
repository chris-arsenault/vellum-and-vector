//! Binds pure settlement mechanisms to current field answers, source providers and owner commands.
use super::{site, Settings};
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
        access::{Access, Entrance},
        catalogue::AccessUse,
        fabric::Town,
        geometry::Point,
        ground::FIRST_STREET,
        influence::{
            frontage_support, Conditions, FrontageRead, OpportunitySource, SiteConditions,
        },
        plots::{slots, Slot},
    },
};
use std::{io, rc::Rc};

struct FrontageTravel<'a> {
    ground: &'a crate::town::ground::Ground,
    spatial: &'a dyn crate::spatial::SpatialKernel,
    links: &'a [(Point, Point, f64)],
}
fn frontage_candidates(
    town: &Town,
    travel: FrontageTravel<'_>,
    slots: &[Slot],
    conditions: &[Conditions],
    sources: &[OpportunitySource],
    movement: bool,
) -> io::Result<Vec<Candidate>> {
    let targets: Vec<_> = slots
        .iter()
        .enumerate()
        .filter(|(_, slot)| !movement || slot.street.is_some())
        .collect();
    if targets.is_empty() {
        return Ok(vec![]);
    }
    // Every attachment can contribute traversable geometry, even when no score is read there.
    let places = sources
        .iter()
        .map(|s| Entrance::source(town, &s.endpoint, s.position))
        .chain(town.holdings().iter().map(|h| Entrance::holding(town, h)))
        .chain(slots.iter().map(|s| Entrance::slot(town, s)))
        .collect::<Vec<_>>();
    let mut access = Access::for_town(town, travel.spatial)?.on_ground(travel.ground);
    for &(a, b, cost) in travel.links {
        access.add_link(a, b, cost, travel.spatial)?;
    }
    let graph = access.bind(&places, AccessUse::Foot, travel.spatial)?;
    let mut queries = graph.distance_queries();
    // hpc-exempt: operating premises identify their counterparties by retained endpoint.
    let mut customers = std::collections::BTreeMap::new();
    // hpc-exempt: patronage is already shared out by the livelihood owner per origin and clientele.
    let mut served = std::collections::BTreeMap::new();
    for holding in town.holdings() {
        for (tie, share) in holding.operating_shares() {
            *customers.entry(&tie.destination).or_insert(0.) += holding.occupation * share;
            if let Some(group) = tie.clientele {
                *served
                    .entry((&tie.destination, group as usize))
                    .or_insert(0.) += tie.strength;
            }
        }
    }
    let offset = sources.len() + town.holdings().len();
    let conditions = targets
        .iter()
        .map(|(i, _)| conditions[*i])
        .collect::<Vec<_>>();
    let competitors = |s: &OpportunitySource| customers.get(&s.endpoint).copied().unwrap_or(0.);
    let served = |s: &OpportunitySource| {
        s.clientele
            .and_then(|group| served.get(&(&s.endpoint, group as usize)))
            .copied()
            .unwrap_or(0.)
    };
    let reach = crate::town::settings::DAILY_REACH;
    let sites = queries.destinations(
        targets
            .iter()
            .enumerate()
            .map(|(site, (i, _))| (offset + i, site)),
    );
    let distances = |source, visit: &mut dyn FnMut(usize, f64)| {
        queries.within(source, reach);
        queries.reached(&sites, reach, visit);
    };
    let read = if movement {
        FrontageRead::HouseholdDemand
    } else {
        FrontageRead::Construction
    };
    let mut opportunities =
        frontage_support(sources, competitors, served, read, &conditions, distances);
    if !movement {
        for (site, productive) in opportunities.iter_mut().zip(productive_frontages(
            &access,
            &graph,
            &places,
            sources,
            offset,
            travel.spatial,
        )?) {
            site.production = productive;
        }
    }
    Ok(targets
        .into_iter()
        .zip(conditions)
        .zip(opportunities)
        .map(|(((_, slot), conditions), opportunities)| Candidate {
            slot: slot.clone(),
            conditions,
            opportunities,
        })
        .collect())
}
fn productive_frontages(
    access: &Access<'_>,
    foot: &crate::town::access::BoundNetwork,
    places: &[Entrance],
    sources: &[OpportunitySource],
    offset: usize,
    spatial: &dyn crate::spatial::SpatialKernel,
) -> io::Result<Vec<crate::town::production::Available>> {
    use crate::town::production::Available;
    let mut available = vec![Available::default(); places.len() - offset];
    if !sources.iter().any(|source| source.productive.is_some()) {
        return Ok(available);
    }
    let reach = crate::town::settings::DAILY_REACH;
    for mode in [AccessUse::Foot, AccessUse::Freight, AccessUse::Waterborne] {
        let bound;
        let network = if mode == AccessUse::Foot {
            foot
        } else {
            bound = access.bind(places, mode, spatial)?;
            &bound
        };
        let mut paths = network.distance_queries();
        let sites = paths.destinations(
            (offset..places.len())
                .enumerate()
                .map(|(i, site)| (site, i)),
        );
        for (i, source) in sources.iter().enumerate() {
            if let Some(offer) = source.productive {
                paths.within(i, reach);
                paths.reached(&sites, reach, |site, cost| {
                    available[site].receive(offer, mode, source.capability, cost);
                });
            }
        }
    }
    Ok(available)
}
pub(super) type Membership = (Option<usize>, Option<crate::town::fabric::HoldingId>);
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
    pub Vec<Vec<Membership>>,
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
    anchors.extend(town.works.active_sites().map(point));
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
    // A hull needs a gangway and a caisson needs a passage. A nearby shore
    // garden, isolated road or external POI cannot support either on its own.
    let mut unsupported = vec![false; candidates.len()];
    for habitat in [
        crate::town::templates::Habitat::Floating,
        crate::town::templates::Habitat::Submerged,
    ] {
        let wet: Vec<_> = candidates
            .iter()
            .enumerate()
            .filter(|(_, s)| s.habitat == habitat)
            .collect();
        if wet.is_empty() {
            continue;
        }
        let occupied: Vec<_> = town
            .holdings()
            .iter()
            .filter(|h| h.slot.habitat == habitat && h.condition > 0.2 && h.occupation > 0.)
            .collect();
        let geometry: Vec<_> = occupied.iter().map(|h| point(h.slot.front)).collect();
        let locations: Vec<_> = wet.iter().map(|(i, _)| fronts[*i]).collect();
        let near = spatial
            .index(&geometry)
            .map_err(io::Error::other)?
            .nearest_many(&locations)
            .map_err(io::Error::other)?;
        for ((i, s), n) in wet.into_iter().zip(near) {
            unsupported[i] = n.is_none_or(|n| {
                crate::town::geometry::distance(s.front, occupied[n].slot.front)
                    > s.depth + occupied[n].slot.depth
            });
        }
    }
    let mut available = Vec::new();
    for ((slot, anchor), unsupported) in candidates.into_iter().zip(nearest).zip(unsupported) {
        if unsupported {
            continue;
        }
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
    seat: &crate::town::seat::Seat,
) -> Vec<Point> {
    use crate::town::{
        access::walking,
        geometry::distance,
        ground::{FREE, STEEP},
    };
    let origin = seat.centre;
    let mesh = state.field().mesh();
    let original_cell = cell_at(mesh, origin);
    let offset = mesh.origin();
    let points: Vec<_> = (0..mesh.len())
        .map(|cell| {
            let p = mesh.position(cell);
            [p[0] + offset[0], p[1] + offset[1]]
        })
        .collect();
    let mut available: Vec<_> = points
        .iter()
        .map(|&p| matches!(ground.owner(p), FREE | STEEP))
        .collect();
    let reach = crate::town::founding::reach(seat.story.size());
    let required_span = seat.story.built_area.sqrt().max(reach);
    let mut ranked = Vec::new();
    for seed in 0..mesh.len() {
        if !available[seed] {
            continue;
        }
        let component = buildable_shelves(mesh, ground, &points, &mut available, seed);
        let span = mesh.cell_span() * (component.len() as f64).sqrt();
        for cell in component {
            let p = if Some(cell) == original_cell
                && ground.owner(origin) == FREE
                && walking::clear(ground, points[cell], origin)
            {
                origin
            } else {
                points[cell]
            };
            // Once the district has room for this place, additional distant land
            // offers diminishing benefit. Nearby usable ground keeps its advantage.
            let cost = (1. + distance(p, origin) / reach) * (1. + required_span / span);
            ranked.push((cost, p));
        }
    }
    // hpc-exempt: rank alternative locations for a captured named settlement.
    ranked.sort_by(|a, b| a.0.total_cmp(&b.0));
    ranked.into_iter().map(|(_, p)| p).collect()
}
/// Follow walkable contours between shelves. Count only land which can hold a parcel.
fn buildable_shelves(
    mesh: &crate::lattice::TriangularLattice,
    ground: &crate::town::ground::Ground,
    points: &[Point],
    available: &mut [bool],
    seed: usize,
) -> Vec<usize> {
    let mut component = vec![seed];
    available[seed] = false;
    let mut next = 0;
    while next < component.len() {
        let cell = component[next];
        next += 1;
        for other in (0..3).filter_map(|edge| mesh.neighbor(cell, edge)) {
            if available[other]
                && crate::town::access::walking::clear(ground, points[cell], points[other])
            {
                component.push(other);
                available[other] = false;
            }
        }
    }
    component.retain(|&cell| ground.owner(points[cell]) == crate::town::ground::FREE);
    component
}
fn settle(
    state: &State,
    seat: crate::town::seat::Seat,
    ground: &crate::town::ground::Ground,
    settings: &Settings,
    context: &super::founding_site::Context<'_>,
    seat_index: usize,
) -> io::Result<Town> {
    let mesh = state.field().mesh();
    let draw =
        crate::field::poi::true_sizes::roll_bytes(&seat.key.to_bytes(), settings.seed as u64);
    for centre in habitable_sites(state, ground, &seat) {
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
                rooted: rooted_ground(state.field(), cell)?,
                bank: shore(state.field(), cell, false)?,
                flowing: shore(state.field(), cell, true)?,
                practices: crate::field::people::crafts::PracticeReads::at(state.field(), cell)?,
                slope: state.field().shared().scalar(Scalar::Slope).get(cell)?,
                ..Conditions::default()
            }))
        };
        let (site, inherited) = context.survey(state, &candidate, seat_index, ground)?;
        let selection = crate::town::templates::Selection::choose(site, draw);
        if settings.template.is_some_and(|requested| {
            !selection
                .ranked
                .iter()
                .any(|candidate| candidate.template == requested)
        }) {
            continue;
        }
        let mut excluded = Vec::new();
        let mut next = Some(settings.template.unwrap_or(selection.selected));
        while let Some(template) = next {
            let mut town = Town::new(candidate.clone(), settings.layout);
            town.template = selection.clone();
            town.template.selected = template;
            if crate::town::founding::establish(&mut town, ground, state.spatial.as_ref(), local)? {
                town.template
                    .ranked
                    .retain(|c| !excluded.contains(&c.template));
                if let Some(work) = settings.major_work {
                    crate::town::major_works::commission_requested(&mut town, settings.seed, work)?;
                }
                crate::town::major_works::commission(&mut town, settings.seed, &inherited);
                return Ok(town);
            }
            if settings.template.is_some() {
                break;
            }
            excluded.push(template);
            let retry = crate::field::poi::true_sizes::roll_bytes(
                &seat.key.to_bytes(),
                (settings.seed as u64).wrapping_add(excluded.len() as u64),
            );
            next = selection.draw_remaining(retry, &excluded);
        }
    }
    let template = settings.template.map_or("", |template| template.name());
    Err(io::Error::other(if template.is_empty() {
        format!("No habitable founding site for {}", seat.name)
    } else {
        format!(
            "No eligible and habitable {template} founding site for {}",
            seat.name
        )
    }))
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
fn rooted_ground(field: &Field, cell: usize) -> io::Result<bool> {
    Ok(field.shared().scalar(Scalar::TreeCover).get(cell)? > 0.
        && field.shared().scalar(Scalar::Verdure).get(cell)? > 0.)
}
/// The environment answers read at a field version. Answer bands are retained, so they
/// stay valid after the process that computed them releases its scratch.
#[derive(Clone, Default)]
struct HeldEnvironment(Rc<std::cell::RefCell<Option<VersionedEnvironment>>>);
type VersionedEnvironment = ((u64, u64), Rc<EnvironmentAnswers>);
impl HeldEnvironment {
    fn read(
        &self,
        scope: &crate::execution::CommandContext<'_, State>,
        query: &Query<State, EnvironmentAnswers>,
    ) -> crate::execution::ExecutionResult<Rc<EnvironmentAnswers>> {
        let version = scope.state().field_version();
        if let Some((held, answers)) = self.0.borrow().as_ref() {
            if *held == version {
                return Ok(answers.clone());
            }
        }
        let answers = scope.query(query)?;
        *self.0.borrow_mut() = Some((version, answers.clone()));
        Ok(answers)
    }
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
pub(super) fn shore(field: &Field, cell: usize, running: bool) -> io::Result<bool> {
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
            let magic = state.physical.magic.as_ref().map(|m| m.borrow());
            let systems = magic.as_ref().map_or(&[][..], |m| m.fields.as_slice());
            let mut roots = crate::field::people::crafts::RootReach::bind(
                field.mesh(),
                systems,
                state.town.towns.iter().flat_map(|town| town.streets()),
                state.spatial.as_ref(),
            )?;
            let slope = field.shared().scalar(Scalar::Slope);
            let waste = field.town_signals().read().map(|(_, b)| b);
            // Neighbouring doors and frontage proposals often sample the same lattice cell.
            let mut cell_samples = vec![usize::MAX; field.mesh().len()];
            let mut sampled = Vec::new();
            let mut result = Vec::new();
            for points in &request.0 {
                let mut values = Vec::new();
                for point in points {
                    let cell = cell_at(field.mesh(), *point).ok_or_else(|| {
                        io::Error::other("Town site lies outside the map lattice")
                    })?;
                    let index = cell_samples[cell];
                    if index != usize::MAX {
                        values.push(sampled[index]);
                        continue;
                    }
                    let mut practices =
                        crate::field::people::crafts::PracticeReads::at(field, cell)?;
                    let rooted = rooted_ground(field, cell)?;
                    let cut = rooted
                        && roots.as_mut().map(|r| r.connected(cell)).transpose()? == Some(false);
                    if cut {
                        practices = practices.with_cut_roots();
                    }
                    let conditions = Conditions {
                        bank: shore(field, cell, false)?,
                        flowing: shore(field, cell, true)?,
                        practices,
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
                        rooted: rooted && !cut,
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
                    };
                    cell_samples[cell] = sampled.len();
                    sampled.push(conditions);
                    values.push(conditions);
                }
                result.push(values)
            }
            Ok(SiteConditions(result))
        },
    )
}
impl Operations {
    /// `signals` reaches the field for writes confined to the town signals; see
    /// `Runtime::town_signal_projection`.
    pub fn new(
        physical: &Physical,
        projection: &Projection<State, Field>,
        signals: &Projection<State, Field>,
    ) -> Self {
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
                                effects: b.effects,
                                practices: a
                                    .practices
                                    .with_local_consecration(b.effects.consecration),
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
                let context = super::founding_site::Context::new(state, &site.seats)?;
                let towns = site
                    .seats
                    .into_iter()
                    .enumerate()
                    .map(|(i, seat)| settle(state, seat, &site.ground, settings, &context, i))
                    .collect::<io::Result<Vec<_>>>()?;
                drop(context);
                state.town.towns = towns;
                Ok(())
            },
        );
        let cleanup = Field::town_clearance_operation().projected(signals);
        // Town steps change the town, not the field the environment is read from, so the
        // environment is kept until the field may have changed.
        let held_environment = HeldEnvironment::default();
        // The ground is marked with what each step added, not built again for every step.
        let held_ground = super::held_ground::HeldGround::default();
        let mut steps: Vec<_> = processes::STEPS
            .iter()
            .map(|step| {
                let sources = sources.clone();
                let samples = samples.clone();
                let environment = environment.clone();
                let held_environment = held_environment.clone();
                let held_ground = held_ground.clone();
                let run = step.run;
                let reads = match run {
                    Mechanism::Movement(_) | Mechanism::Frontage(_) => processes::Reads::Frontage,
                    Mechanism::Livelihood(_) => processes::Reads::Livelihood,
                    _ => processes::Reads::Exposure,
                };
                let cleanup = cleanup.clone();
                let mut dependencies = Vec::new();
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
                        let environment = held_environment.read(scope, &environment)?;
                        let walking_ground = held_ground.walking(scope.state())?;
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
                                        std::iter::once(town.seat.centre)
                                            .chain(
                                                town.holdings()
                                                    .iter()
                                                    .filter(|h| h.condition > 0.2)
                                                    .map(|h| h.slot.front),
                                            )
                                            .chain(town.works.active_sites()),
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
                                    .filter_map(|s| {
                                        crate::town::founding::survey_slot(town, &walking_ground, s)
                                    })
                                    .filter(|s| {
                                        cell_at(scope.state().field().mesh(), s.front).is_some()
                                    })
                                    .collect::<Vec<_>>();
                                let mut sites = inhabited_frontage(
                                    town,
                                    sites,
                                    &source.0,
                                    scope.state().spatial.as_ref(),
                                )?;
                                sites.extend(
                                    town.works
                                        .water_sites(&walking_ground, town.round)
                                        .into_iter()
                                        .filter(|s| {
                                            cell_at(scope.state().field().mesh(), s.front).is_some()
                                        }),
                                );
                                Ok::<_, io::Error>(sites)
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
                                        .map(|h| {
                                            (h.slot.street, h.institution.or(h.slot.participant))
                                        })
                                        .chain(candidates.iter().map(|s| (s.street, s.participant)))
                                        .chain(
                                            outlying.iter().flat_map(|site| {
                                                site.samples().map(|_| (None, None))
                                            }),
                                        )
                                        .collect()
                                })
                                .collect(),
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
                        // The step takes streets and places holdings on its own copy.
                        let mut ground = (reads == processes::Reads::Frontage)
                            .then(|| held_ground.occupied(state).map(|g| (*g).clone()))
                            .transpose()?;
                        let mut removals = Vec::new();
                        for (index, town) in state.town.towns.iter_mut().enumerate() {
                            let n = town.holdings().len();
                            let proposals = frontage_candidates(
                                town,
                                FrontageTravel {
                                    ground: &walking_ground,
                                    links: &links,
                                    spatial: spatial.as_ref(),
                                },
                                &candidates[index],
                                &conditions.0[index][n..],
                                &source.0,
                                matches!(run, Mechanism::Movement(_)),
                            )?;
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
                                town.resolve_approaches(&walking_ground, spatial.as_ref())?;
                                town.round += 1;
                            }
                        }
                        if step.id == "town.maintenance" {
                            let material_uses = super::providers::material_uses(state);
                            state.work_town_material(&material_uses)?;
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
        let pressure = Field::town_pressure_operation().projected(signals);
        let signal_environment = environment.clone();
        let pressure: Command<State> = Command::with_inputs(
            "town.signals",
            CommandKind::Work,
            vec![],
            move |scope, _: &()| {
                let friction = held_environment
                    .read(scope, &signal_environment)?
                    .travel
                    .clone();
                let field = scope.state().field();
                let mut sources = Vec::new();
                for town in &scope.state().town.towns {
                    sources.extend(town.passing_trade().filter_map(|(point, activity)| {
                        cell_at(field.mesh(), point).map(|cell| (cell, activity / 100., 0.))
                    }));
                    for holding in town.holdings() {
                        if let Some(cell) = cell_at(field.mesh(), holding.slot.front) {
                            sources.push((
                                cell,
                                0.,
                                holding.occupation * (0.02 + holding.crowding * 0.1),
                            ));
                        }
                    }
                }
                let links = super::providers::kept_links(scope.state())?;
                scope.run(
                    &pressure,
                    &crate::town::signals::Inputs {
                        sources,
                        links,
                        friction,
                    },
                )
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
