//! Binds pure settlement mechanisms to current field answers, source providers and owner commands.
use super::{site, Settings};
use crate::features::Feature;
use crate::processes::strategies::{Absent, Condition, EffectTime, Source, Strategy};
use crate::town::templates::civic::Civic;
use crate::{
    atlas::{physical::Physical, state::State},
    execution::{Command, CommandKind, Projection, Query},
    field::{
        refinement::{courses::cell_at, people},
        shared::Scalar,
        Field,
    },
    processes::town::{self as processes, urban::street_context, Candidate, Mechanism},
    town::{
        access::{Access, Entrance},
        catalogue::{AccessUse, PlaceRules, Site},
        fabric::Town,
        geometry::Point,
        ground::FIRST_STREET,
        influence::{
            frontage_support, household_demand_from_sites, Conditions, FrontageRead,
            OpportunitySource, Reading, SiteConditions,
        },
        plots::{slots, Slot},
        scale::{Fidelity, Measure, TownScale},
        settings::CANDIDATE_REACH,
    },
};
use std::{io, rc::Rc};

#[derive(Clone, Copy)]
pub(crate) struct CapturedSeat;
pub(crate) enum SettlementStart {
    District(Box<Feature>),
    Seats(site::Site),
}
impl Source for CapturedSeat {
    type Value = SettlementStart;
}
#[derive(Clone, Copy)]
pub(crate) struct NeighbouringPlaces;
impl Source for NeighbouringPlaces {
    type Value = Vec<Feature>;
}
pub(crate) type Founding = Strategy<(), CapturedSeat, NeighbouringPlaces>;
pub(crate) const STREET_FOUNDING: Founding = Strategy {
    name: "street-founding-policy",
    time: EffectTime::Present,
    slot: "town initialization",
    initial: Condition::From {
        source: CapturedSeat,
        absent: Absent::Error("Missing settlement capture"),
    },
    boundary: Condition::From {
        source: NeighbouringPlaces,
        absent: Absent::Empty,
    },
    algorithm: (),
};
/// The passing trade along a stretch of street this long makes one unit of exchange signal.
/// Street metres, resolved by `Measure::Layout`.
const TRADE_STRETCH: f64 = 100.;

/// What a town's frontage is travelled over: the walking ground, the kernel, the kept links,
/// and the town's scale, which travel costs are read at.
struct FrontageTravel<'a> {
    ground: &'a crate::town::ground::Ground,
    spatial: &'a dyn crate::spatial::SpatialKernel,
    links: &'a [(Point, Point, f64)],
    scale: TownScale,
}
fn frontage_candidates(
    town: &Town,
    travel: FrontageTravel<'_>,
    slots: &[Slot],
    conditions: &[Conditions],
    sources: &[OpportunitySource],
    movement_ground: Option<&crate::town::ground::Ground>,
) -> io::Result<Vec<Candidate>> {
    let movement = movement_ground.is_some();
    let targets: Vec<_> = slots
        .iter()
        .enumerate()
        .filter(|(_, slot)| {
            movement_ground.is_none_or(|ground| {
                use crate::town::ground::{Rectangle, FREE, STEEP};
                slot.street.is_some()
                    && ground.open_with(&Rectangle(&slot.corners), |owner| {
                        owner == FREE || owner == STEEP || owner >= FIRST_STREET
                    })
            })
        })
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
    let scale = travel.scale;
    let reach = scale.length(crate::town::settings::DAILY_REACH, Measure::Travel);
    let entrances: Vec<_> = targets.iter().map(|(i, _)| offset + i).collect();
    let reading = Reading {
        sites: &conditions,
        scale,
    };
    let read = if movement {
        FrontageRead::HouseholdDemand
    } else {
        FrontageRead::Construction
    };
    let from_sites = if movement {
        household_demand_from_sites(sources, competitors, reading, &entrances, &mut queries)
    } else {
        None
    };
    let mut opportunities = from_sites.unwrap_or_else(|| {
        let sites = queries.destinations(entrances.iter().enumerate().map(|(site, &i)| (i, site)));
        frontage_support(
            sources,
            competitors,
            served,
            read,
            reading,
            |source, visit| {
                queries.within(source, reach);
                queries.reached(&sites, reach, visit);
            },
        )
    });
    if !movement {
        for (site, productive) in opportunities.iter_mut().zip(productive_frontages(
            &access, &graph, &places, sources, offset, &travel,
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
    travel: &FrontageTravel<'_>,
) -> io::Result<Vec<crate::town::production::Available>> {
    use crate::town::production::Available;
    let (spatial, scale) = (travel.spatial, travel.scale);
    let mut available = vec![Available::default(); places.len() - offset];
    // The construction bid reads the strongest reachable supply per commodity.
    // Economic ties to individual producers are resolved by the livelihood process.
    // hpc-exempt: named producers grouped by their offered commodity.
    let mut groups = std::collections::BTreeMap::new();
    for (i, source) in sources.iter().enumerate() {
        if let Some(kind) = source.productive.filter(|_| source.capability > 0.) {
            groups
                .entry(kind)
                .or_insert_with(Vec::new)
                .push((i, source.capability));
        }
    }
    if groups.is_empty() {
        return Ok(available);
    }
    for producers in groups.values_mut() {
        // hpc-exempt: rank alternative suppliers of a commodity by available supply.
        producers.sort_unstable_by(|(_, a), (_, b)| b.total_cmp(a));
    }
    let reach = scale.length(crate::town::settings::DAILY_REACH, Measure::Travel);
    for mode in [AccessUse::Foot, AccessUse::Freight, AccessUse::Waterborne] {
        let bound;
        let network = if mode == AccessUse::Foot {
            foot
        } else {
            bound = access.bind(places, mode, spatial)?;
            &bound
        };
        let paths = network.distance_queries();
        let sites = paths.destinations(
            (offset..places.len())
                .enumerate()
                .map(|(i, site)| (site, i)),
        );
        for (opportunity, producers) in &groups {
            paths.improving_offers(producers, &sites, reach, |site, capability, cost| {
                available[site].receive(*opportunity, mode, capability, cost, scale);
            });
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
pub struct SiteRequests {
    pub(super) towns: Vec<TownSites>,
    environment: Rc<EnvironmentAnswers>,
    pub(super) ground: Rc<crate::town::ground::Ground>,
}
pub(super) struct TownSites {
    pub(super) points: Vec<Point>,
    pub(super) memberships: Vec<Membership>,
    pub(super) needs_services: bool,
}
impl TownSites {
    fn new(
        run: Mechanism,
        holdings: &[crate::town::fabric::Holding],
        candidates: &[Slot],
        outlying: impl ExactSizeIterator<Item = [Point; 2]>,
    ) -> Self {
        // A road bid reads household demand and local tract density. Only a
        // new outlying settlement in this step needs care, learning and protection.
        let needs_services = !matches!(run, Mechanism::Movement(_)) || outlying.len() != 0;
        let (points, memberships) = holdings
            .iter()
            .map(|h| {
                (
                    h.slot.front,
                    (h.slot.street, h.institution.or(h.slot.participant)),
                )
            })
            .chain(
                candidates
                    .iter()
                    .map(|s| (s.front, (s.street, s.participant))),
            )
            .chain(outlying.flatten().map(|point| (point, (None, None))))
            .unzip();
        Self {
            points,
            memberships,
            needs_services,
        }
    }
}

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
    // A City tract already houses people before the Street map places their individual homes.
    if let Some(district) = &town.district {
        anchors.extend(
            district
                .tracts
                .iter()
                .filter(|tract| {
                    tract.density_per_km2.is_some_and(|people| people > 0.)
                        && tract.built_share.is_some_and(|built| built > 0.)
                })
                .map(|tract| tract.area.clone()),
        );
    }
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
    for ((slot, front), unsupported) in candidates.into_iter().zip(fronts).zip(unsupported) {
        if unsupported {
            continue;
        }
        if index
            .nearest_with_distance(front)
            .map_err(io::Error::other)?
            .is_some_and(|(_, gap)| gap <= slot.depth * 2.)
        {
            available.push(slot);
        }
    }
    Ok(available)
}

/// An occupied street opens the land behind it, in a town and in a City district alike. A
/// new independent house can use that land without itself surveying another belt of plots
/// before a street reaches it.
fn open_land_origins(town: &Town) -> impl Iterator<Item = Point> + '_ {
    let origins = town.holdings().iter().filter(|h| {
        if !h.standing() || h.occupation <= 0. {
            return false;
        }
        if h.slot.street.is_some() {
            return true;
        }
        let independent_founding =
            h.established == 0 && h.slot.street.is_none() && h.slot.participant.is_none();
        let local_livelihood = std::iter::once(h.kind).chain(h.secondary).any(|kind| {
            matches!(
                kind.definition().premises.site,
                Site::WorkingLand
                    | Site::RootedGround
                    | Site::Waterfront
                    | Site::FlowingWater
                    | Site::PractisedGround
            )
        });
        independent_founding || local_livelihood
    });
    std::iter::once(town.seat.centre)
        .chain(origins.map(|h| h.slot.front))
        .chain(town.works.active_sites())
}

/// Nearby sites compete on connected buildable land and distance to the captured
/// settlement. A dry ledge cut off by cliffs is a poor substitute for a river valley.
fn habitable_sites(
    state: &State,
    ground: &crate::town::ground::Ground,
    seat: &crate::town::seat::Seat,
    scale: TownScale,
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
    let reach = crate::town::founding::reach(scale, seat.story.size());
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
/// The founding survey of the seats being settled, which of them this one is, and the
/// fidelity its town is surveyed and founded at.
#[derive(Clone, Copy)]
struct Survey<'c, 'a> {
    context: &'c super::founding_site::Context<'a>,
    seat: usize,
    fidelity: Fidelity,
}
fn founding_conditions(state: &State, point: Point) -> io::Result<Option<Conditions>> {
    let field = state.field();
    let Some(cell) = cell_at(field.mesh(), point) else {
        return Ok(None);
    };
    Ok(Some(Conditions {
        cultivated: site::worked_shares(field, cell)?.0,
        rooted: rooted_ground(field, cell)?,
        bank: shore(field, cell, false)?,
        flowing: shore(field, cell, true)?,
        practices: crate::field::people::crafts::PracticeReads::at(field, cell)?,
        slope: field.shared().scalar(Scalar::Slope).get(cell)?,
        ..Conditions::default()
    }))
}
fn settle(
    state: &State,
    seat: crate::town::seat::Seat,
    ground: &crate::town::ground::Ground,
    settings: &Settings,
    survey: Survey<'_, '_>,
) -> io::Result<Option<Town>> {
    let fidelity = survey.fidelity;
    let scale = TownScale::new(fidelity);
    let draw =
        crate::field::poi::true_sizes::roll_bytes(&seat.key.to_bytes(), settings.seed as u64);
    let record = match state.records.source_features.as_deref() {
        Some(source) => source.get(seat.key)?,
        None => state.records.features.get(seat.key)?,
    };
    let attributes = record.as_ref().map(|record| &record.attributes);
    let saved_policy: Option<crate::town::templates::Selection> = attributes
        .and_then(|attrs| attrs.get("templatePolicy"))
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()?;
    let saved = saved_policy
        .as_ref()
        .map(|policy| policy.selected)
        .or_else(|| {
            attributes
                .and_then(|attrs| attrs.get("settlementTemplate"))
                .and_then(|value| value.as_str())
                .and_then(crate::town::templates::Template::from_name)
        });
    let required = saved.or(settings.template);
    let district = record.as_ref().is_some_and(|f| f.kind == "district");
    for centre in habitable_sites(state, ground, &seat, scale) {
        let mut candidate = seat.clone();
        candidate.centre = centre;
        for arm in &mut candidate.arms {
            arm.points[0] = centre;
        }
        let local = |point| founding_conditions(state, point);
        let (site, inherited) =
            survey
                .context
                .survey(state, &candidate, survey.seat, ground, scale)?;
        let mut selection = saved_policy.clone().unwrap_or_else(|| {
            let civic_draw = Civic::roll(&seat.key.to_bytes(), settings.seed);
            crate::town::templates::Selection::choose(site, draw).with_civic(None, civic_draw)
        });
        // A town made again keeps the order its record names, as it keeps its template.
        let recorded = attributes
            .and_then(|attrs| attrs.get("civicOrder"))
            .and_then(|value| value.as_str())
            .and_then(Civic::from_name);
        selection.civic = settings
            .civic
            .or(saved_policy.as_ref().and_then(|policy| policy.civic))
            .or(recorded)
            .or(selection.civic);
        if saved.is_none()
            && required.is_some_and(|requested| {
                !selection
                    .ranked
                    .iter()
                    .any(|candidate| candidate.template == requested)
            })
        {
            continue;
        }
        let mut excluded = Vec::new();
        let mut next = Some(required.unwrap_or(selection.selected));
        while let Some(template) = next {
            let mut town = Town::new(candidate.clone(), settings.layout);
            town.fidelity = fidelity;
            town.template = selection.clone();
            town.template.selected = template;
            town.ordered(settings.order);
            if crate::town::founding::establish(&mut town, ground, state.spatial.as_ref(), local)? {
                town.template
                    .ranked
                    .retain(|c| !excluded.contains(&c.template));
                if let Some(work) = settings.major_work {
                    crate::town::major_works::commission_requested(&mut town, settings.seed, work)?;
                }
                // A district inherits the works its city already commissioned.
                if !district {
                    crate::town::major_works::commission(&mut town, settings.seed, &inherited);
                }
                return Ok(Some(town));
            }
            if required.is_some() {
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
    Ok(None)
}
/// A settlement that must found and found nowhere.
fn no_site(name: &str, settings: &Settings) -> io::Error {
    let template = settings.template.map_or("", |template| template.name());
    io::Error::other(if template.is_empty() {
        format!("No habitable founding site for {name}")
    } else {
        format!("No eligible and habitable {template} founding site for {name}")
    })
}
pub struct Operations {
    pub(crate) initialize: Command<State, (Settings, Founding)>,
    pub(crate) steps: Vec<(
        &'static str,
        Command<State, processes::urban::registration::LocalInputs>,
    )>,
    pub(crate) pressure: Command<State>,
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
            let travel = &request.environment.travel;
            let building = &request.environment.building;
            let harm = &request.environment.harm;
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
            for town in &request.towns {
                let mut values = Vec::new();
                for point in &town.points {
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
                        standing: (field
                            .people()
                            .view(crate::human::HumanField::Layer(
                                crate::human::catalogue::LayerId::BuiltUp,
                            ))
                            .get(cell)?
                            > 0.)
                            .then(|| field.people().standing(cell))
                            .transpose()?,
                        yielding: request.environment.yielding.get(cell)?,
                        forgetting: request.environment.forgetting.get(cell)?,
                        presence: request.environment.presence.get(cell)?,
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
            |scope, (settings, founding): &(Settings, Founding)| {
                let state: &mut State = scope.state_mut();
                if !state.town.towns.is_empty()
                    || !state
                        .regional
                        .as_ref()
                        .is_some_and(|r| people::enabled(&r.domains))
                {
                    return Ok(());
                }
                let Some(start) = founding.initial.bind(|CapturedSeat| {
                    match state
                        .regional
                        .as_ref()
                        .and_then(|r| r.city.urban.captured().first())
                    {
                        Some(district) => {
                            Ok(Some(SettlementStart::District(Box::new(district.clone()))))
                        }
                        None => Ok(Some(SettlementStart::Seats(site::starting(state)?))),
                    }
                })?
                else {
                    return Ok(());
                };
                let neighbours = founding
                    .boundary
                    .bind(|NeighbouringPlaces| {
                        match &start {
                            SettlementStart::District(_) => Ok(state
                                .regional
                                .as_ref()
                                .expect("captured City district")
                                .city
                                .urban
                                .captured()
                                .to_vec()),
                            SettlementStart::Seats(_) => {
                                super::providers::contextual_features(state)
                            }
                        }
                        .map(Some)
                    })?
                    .unwrap_or_default();
                let site = match start {
                    SettlementStart::District(district) => {
                        let mut town = street_context::inherit(state, &district, &neighbours)?;
                        town.template.civic = settings.civic.or(town.template.civic);
                        town.ordered(settings.order);
                        let mut ground = site::terrain(state, site::bounds(state)?)?;
                        if let Some(site) = &town.district {
                            ground.mark_shapes(
                                &site.reserves,
                                crate::town::ground::SQUARE,
                                state.spatial.as_ref(),
                            )?;
                        }
                        let origins = processes::urban::neighbourhood::streets(
                            &mut town,
                            &ground,
                            state.spatial.as_ref(),
                        )?;
                        crate::town::founding::occupy_district(
                            &mut town,
                            origins,
                            &ground,
                            state.spatial.as_ref(),
                            |p| founding_conditions(state, p),
                        )?;
                        state.town.towns.push(town);
                        return Ok(());
                    }
                    SettlementStart::Seats(site) => site,
                };
                let context = super::founding_site::Context::new(state, &site.seats, neighbours)?;
                let towns = site
                    .seats
                    .into_iter()
                    .enumerate()
                    .map(|(i, seat)| {
                        let name = seat.name.clone();
                        settle(
                            state,
                            seat,
                            &site.ground,
                            settings,
                            Survey {
                                context: &context,
                                seat: i,
                                fidelity: Fidelity::Street,
                            },
                        )?
                        .ok_or_else(|| no_site(&name, settings))
                    })
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
        let steps: Vec<_> = processes::STEPS
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
                    move |scope, inputs: &processes::urban::registration::LocalInputs| {
                        let source = if reads == processes::Reads::Exposure {
                            Rc::new(crate::town::influence::Sources(vec![]))
                        } else {
                            scope.query(&sources)?
                        };
                        let environment = held_environment.read(scope, &environment)?;
                        let walking_ground =
                            inputs.ground(|| held_ground.walking(scope.state()))?;
                        let candidates: Vec<Vec<Slot>> = scope
                            .state()
                            .town
                            .towns
                            .iter()
                            .map(|town| {
                                if reads != processes::Reads::Frontage {
                                    return Ok(vec![]);
                                }
                                let scale = town.scale();
                                // Where the City found a district's households with ground
                                // to spare, the plots offered to them are that much larger.
                                let roomy = town
                                    .district
                                    .as_ref()
                                    .map_or(1., crate::town::fabric::DistrictSite::plot_scale);
                                let order = town.order;
                                let frontage =
                                    roomy * scale.length(order.plot_frontage, Measure::Plot);
                                let depth = roomy * scale.length(order.plot_depth, Measure::Plot);
                                let sites = town
                                    .streets()
                                    .iter()
                                    .enumerate()
                                    .flat_map(|(i, street)| {
                                        slots(i, street, frontage, depth, scale)
                                    })
                                    .chain(crate::town::land_sites::around(
                                        open_land_origins(town),
                                        roomy * scale.length(CANDIDATE_REACH, Measure::Layout),
                                        frontage,
                                        depth,
                                        town.round,
                                    ))
                                    .chain(town.holdings().iter().flat_map(|h| {
                                        crate::town::plots::participant_slots_at(h, scale)
                                    }))
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
                        let requests = Rc::new(SiteRequests {
                            towns: scope
                                .state()
                                .town
                                .towns
                                .iter()
                                .zip(&candidates)
                                .zip(&outlying)
                                .map(|((town, candidates), outlying)| {
                                    TownSites::new(
                                        run,
                                        town.holdings(),
                                        candidates,
                                        outlying.iter().map(|site| site.samples()),
                                    )
                                })
                                .collect(),
                            environment,
                            ground: walking_ground.clone(),
                        });
                        let conditions =
                            inputs.conditions(|| scope.query_with_context(&samples, requests))?;
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
                        let field = state.physical.executor.state();
                        let channel_depth = |point| {
                            let Some(cell) = cell_at(field.mesh(), point) else {
                                return Ok(None);
                            };
                            let water = field.water();
                            if water.river_orders.get(cell)? == 0 {
                                return Ok(None);
                            }
                            Ok(Some(water.channels.depth.get(cell)?))
                        };
                        for (index, town) in state.town.towns.iter_mut().enumerate() {
                            let n = town.holdings().len();
                            let mut proposals = frontage_candidates(
                                town,
                                FrontageTravel {
                                    ground: &walking_ground,
                                    links: &links,
                                    spatial: spatial.as_ref(),
                                    scale: town.scale(),
                                },
                                &candidates[index],
                                &conditions.0[index][n..],
                                &source.0,
                                ground
                                    .as_ref()
                                    .filter(|_| matches!(run, Mechanism::Movement(_))),
                            )?;
                            let observations = &conditions.0[index];
                            let mut held = observations[..n].to_vec();
                            street_context::respond(
                                town,
                                &mut proposals,
                                &mut held,
                                spatial.as_ref(),
                                field,
                            )?;
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
                            let conditions = held.as_slice();
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
                                            channel_depth: &channel_depth,
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
                            if step.id == "town.premises-upkeep" {
                                town.resolve_approaches(&walking_ground, spatial.as_ref())?;
                                town.round += 1;
                            }
                        }
                        if step.id == "town.premises-upkeep"
                            && state.town.towns.first().is_some_and(|town| {
                                town.round as usize == crate::town::settings::DEVELOPMENT_ROUNDS
                            })
                        {
                            // The final set of operating premises draws the present craft material once.
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
                    let stretch = town.scale().length(TRADE_STRETCH, Measure::Layout);
                    sources.extend(town.passing_trade().filter_map(|(point, activity)| {
                        cell_at(field.mesh(), point).map(|cell| (cell, activity / stretch, 0.))
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
        Self {
            initialize,
            steps,
            pressure,
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

#[cfg(test)]
mod frontage_tests {
    use super::*;
    use crate::town::{
        fabric::{DistrictSite, DistrictTract},
        network::{Class, Street},
        seat::Seat,
    };
    use atlas_map::{regions::rectangle, Bounds, Id};

    #[test]
    fn road_proposals_need_service_allocation_only_when_siting_new_households() {
        let mut slots = crate::town::land_sites::around([[0., 0.]], 35., 15., 24., 0);
        slots[0].street = Some(3);
        let movement = processes::STEPS
            .iter()
            .find(|s| s.id == "town.movement")
            .unwrap()
            .run;
        let roads = TownSites::new(movement, &[], &slots, std::iter::empty());
        assert!(!roads.needs_services);
        assert_eq!(roads.memberships[0], (Some(3), None));
        let founding = [[120., 0.], [120., 20.]];
        let settlement = TownSites::new(movement, &[], &slots, std::iter::once(founding));
        assert!(settlement.needs_services);
        assert_eq!(&settlement.points[slots.len()..], &founding);
        for step in processes::STEPS.iter().filter(|s| s.id != "town.movement") {
            assert!(TownSites::new(step.run, &[], &slots, std::iter::empty()).needs_services);
        }
    }

    #[test]
    fn an_independent_town_house_does_not_open_another_belt_of_unserved_housing() {
        use crate::town::{catalogue::PLACES, fabric::Proposal, land_sites};

        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = Town::new(
            Seat {
                key: Id::from_name("market village"),
                name: "Market village".into(),
                centre: [0., 0.],
                story: Default::default(),
                arms: vec![],
                culture: None,
            },
            None,
        );
        let house = PLACES
            .into_iter()
            .find(|k| {
                k.definition().roles.dwelling
                    && matches!(k.definition().premises.site, Site::PreferStreet)
            })
            .unwrap();
        let survey = |town: &mut Town, anchor, round| {
            town.round = round;
            let slot = land_sites::around([anchor], 35., 15., 24., round).remove(0);
            let front = slot.front;
            let id = town
                .establish(
                    Proposal {
                        kind: house,
                        means: 0.5,
                        priority: 1.,
                        cause: "Independent dwelling".into(),
                        slot,
                    },
                    &spatial,
                )
                .unwrap()
                .unwrap();
            town.occupy(id, 1., 0.5, 1., 0.);
            front
        };
        let founding = survey(&mut town, [100., 0.], 0);
        let later = survey(&mut town, [200., 0.], 2);
        let origins: Vec<_> = open_land_origins(&town).collect();
        assert!(origins.contains(&founding));
        assert!(!origins.contains(&later));
    }

    #[test]
    fn an_avenue_can_offer_frontage_on_inhabited_city_ground_far_from_the_seat() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = Town::new(
            Seat {
                key: Id::from_name("district"),
                name: "District".into(),
                centre: [0., 0.],
                story: Default::default(),
                arms: vec![],
                culture: None,
            },
            None,
        );
        let road = Street::new(
            vec![[500., 0.], [1000., 0.]],
            Class::Main,
            town.seat.story.size(),
        );
        let plots = slots(0, &road, 12., 20., town.scale());
        assert!(!plots.is_empty());
        assert!(inhabited_frontage(&town, plots.clone(), &[], &spatial)
            .unwrap()
            .is_empty());
        let tract = |west, east, people| DistrictTract {
            civic: false,
            area: rectangle(Bounds(west, -80., east, 80.)),
            mix: Default::default(),
            built_share: Some(0.3),
            developed_m2: 12_000.,
            density_per_km2: Some(people),
        };
        town.district = Some(DistrictSite {
            outline: rectangle(Bounds(-100., -100., 1100., 100.)),
            tracts: vec![tract(500., 750., 2000.), tract(800., 1000., 0.)],
            streets: vec![],
            reserves: vec![],
            program: None,
            density_per_km2: None,
            old_walls: None,
        });
        let available = inhabited_frontage(&town, plots, &[], &spatial).unwrap();
        assert!(available
            .iter()
            .any(|p| (550.0..700.0).contains(&p.front[0])));
        assert!(available.iter().all(|p| p.front[0] < 800.));
    }

    #[test]
    fn a_spacious_district_offers_larger_plots_and_a_crowded_one_ordinary_plots() {
        let district = |built: f64, people: f64| DistrictSite {
            outline: rectangle(Bounds(0., 0., 300., 300.)),
            reserves: vec![],
            streets: vec![],
            program: None,
            tracts: vec![DistrictTract {
                civic: false,
                area: rectangle(Bounds(0., 0., 300., 300.)),
                mix: Default::default(),
                built_share: Some(built),
                developed_m2: built * 90_000.,
                density_per_km2: Some(people),
            }],
            density_per_km2: Some(people),
            old_walls: None,
        };
        // Estates, 95% built at 5,000 people per square kilometre: each resident has 190
        // square metres, 3.8 times a street household's, so plots are 1.95 times as wide
        // and as deep.
        let estates = district(0.95, 5_000.);
        assert!((estates.tracts[0].spaciousness().unwrap() - 3.8).abs() < 1e-9);
        assert!((estates.plot_scale() - 3.8f64.sqrt()).abs() < 1e-9);
        // Tenements at 40,000 share ordinary plots and build upward.
        let tenements = district(0.9, 40_000.);
        assert!((tenements.tracts[0].spaciousness().unwrap() - 0.45).abs() < 1e-9);
        assert_eq!(tenements.plot_scale(), 1.);
        // A tract the City records no people on says nothing.
        assert_eq!(district(0.9, 0.).tracts[0].spaciousness(), None);
        assert_eq!(district(0.9, 0.).plot_scale(), 1.);
    }

    #[test]
    fn inhabited_district_land_behind_an_avenue_starts_with_a_way_in_and_a_kernel() {
        use crate::spatial::{Predicate, SpatialKernel};
        use crate::town::{founding::occupy_district, ground::Ground, growth::line};
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = Town::new(
            Seat {
                key: Id::from_name("quarter"),
                name: "Quarter".into(),
                centre: [150., 150.],
                story: crate::town::story::Story {
                    people: 5000.,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        );
        town.set_approaches(vec![Street::new(
            vec![[20., 0.], [20., 350.]],
            Class::Main,
            town.seat.story.size(),
        )]);
        town.district = Some(DistrictSite {
            outline: rectangle(Bounds(0., 0., 360., 360.)),
            reserves: vec![],
            streets: vec![(Id::from_name("avenue"), "Avenue".into())],
            program: None,
            tracts: vec![DistrictTract {
                civic: false,
                area: rectangle(Bounds(40., 30., 320., 310.)),
                mix: Default::default(),
                built_share: Some(0.46),
                developed_m2: 36_000.,
                density_per_km2: Some(4000.),
            }],
            density_per_km2: Some(4000.),
            old_walls: None,
        });
        let ground = Ground::new([0., 0., 360., 360.], 2.);
        let origins =
            processes::urban::neighbourhood::streets(&mut town, &ground, &spatial).unwrap();
        let roads: Vec<_> = town.streets().iter().map(|s| line(&s.points)).collect();
        // Founding opens at most a way in from the avenue; the rounds open the rest.
        assert!(roads.len() <= 2, "founding lays no block streets");
        let mut reached = vec![false; roads.len()];
        reached[0] = true;
        let mut pending = vec![0];
        while let Some(i) = pending.pop() {
            for j in 0..roads.len() {
                if !reached[j]
                    && spatial
                        .relation(&roads[i], &roads[j], Predicate::Intersects)
                        .unwrap()
                {
                    reached[j] = true;
                    pending.push(j);
                }
            }
        }
        assert!(
            reached.iter().all(|r| *r),
            "the way in must connect to the avenue"
        );
        occupy_district(&mut town, origins, &ground, &spatial, |_| {
            Ok(Some(Conditions::default()))
        })
        .unwrap();
        let occupied: Vec<_> = town
            .holdings()
            .iter()
            .filter(|h| h.occupation > 0. && h.slot.street.is_some())
            .collect();
        // The tract starts with a kernel, far short of the hundred and more premises its
        // developed ground has room for.
        assert!(
            !occupied.is_empty() && occupied.len() < 20,
            "the tract starts with a founding kernel on its street"
        );
        // An occupied street opens the land behind it, in a district as in a town.
        let front = occupied[0].slot.front;
        assert!(open_land_origins(&town).any(|p| p == front));
        town.district = None;
        assert!(open_land_origins(&town).any(|p| p == front));
    }
}
