//! Access investments follow occupied land, unmet destinations and useful network connections.
use super::Frontage;
use crate::town::{
    access::{Access, BoundNetwork, Course, Entrance, StreetLoad, Stretch},
    catalogue::{AccessUse, Activity, PlaceRules},
    edits::line,
    fabric::{EditOutcome, FabricEdit, FabricOwner, Relationship, Specification, Town},
    geometry::{add, distance, dot, left, scale, sub, unit, Point},
    ground::{FIRST_STREET, PLOT},
    growth::StreetLines,
    network::{Class, StreetProposal as Project},
    scale::Measure,
    story::Layout,
};
use atlas_map::{Geometry, Position};
use std::io;

// Street work laid out between plots. Street metres, resolved by `Measure::Layout`.
/// How far past two plot depths a street's end looks for its own holdings.
const END_PAD: f64 = 5.;
/// A backland lane starts this far beside and in front of a plot's flank. How far it runs
/// behind the plot is the town's order's to say.
const BACKLAND_OFFSET: f64 = 5.;
/// Street ends nearer than this are not joined by a shortcut; a shortcut's gain is measured
/// against its direct length and this much more. The saving that earns a shortcut and the
/// spacing a new route keeps from other streets are the town's order's to say.
const SHORTCUT_LEAST: f64 = 25.;
const SHORTCUT_SLACK: f64 = 40.;
/// The shortest route worth building, and the least length any connection is charged for.
const MINIMUM_ROUTE: f64 = 20.;
const LEAST_CONNECTION: f64 = 1.;
/// The distance from the centre at which new frontage is half as wanted as at the centre.
/// Street metres, resolved by `Measure::Adjacency`.
const CENTRE_PULL: f64 = 140.;
/// The plot depth at which backland is half as worth a lane. Street metres, resolved by
/// `Measure::Plot`.
const DEEP_PLOT: f64 = 100.;
/// The people one dwelling premises houses when reckoning how housed a town is; a holding
/// houses this many for each premises it stands for (`TownScale::premises`).
const PEOPLE_PER_HOME: f64 = 5.;

enum Investment {
    Route(Project),
    Widen(StreetLoad),
    Surface(super::walks::LaneCourse),
    Settle(usize),
}

pub(super) struct StreetTrace<'a> {
    name: &'a str,
    round: u32,
    enabled: bool,
}

impl StreetTrace<'_> {
    pub(super) fn event(&self, details: impl FnOnce() -> serde_json::Value) {
        if self.enabled {
            eprintln!(
                "{}",
                serde_json::json!({
                    "event": "town.street-decision", "town": self.name,
                    "round": self.round, "decision": details()
                })
            );
        }
    }
}

/// The street work of a City district's people whose homes this map has not placed yet. The
/// City records them as living in the district already, so they walk and cart its ways and
/// share in making them, as residents without means of their own do. A standalone town has
/// only the residents it has housed.
fn unplaced_street_workers(district_people: Option<f64>, housed: f64) -> f64 {
    district_people.map_or(0., |people| 0.5 * (people - housed).max(0.))
}

// owner-direction(2026-11-27): a city cannot be constructed by one process that lays out streets from a setting, such as a grid with grid spacing as a variable; a table of such values per template is right when each value is one part of a formula and the processes feed back
pub fn advance(town: &mut Town, context: &mut Frontage<'_>) -> io::Result<()> {
    let (mut participants, mut housed) = (0., 0.);
    for holding in town.holdings().iter().filter(|h| h.occupation > 0.) {
        let premises = super::economy::FloorSpace::holding(holding, context.spatial)?;
        let residents = premises.occupied_residents(holding.occupation);
        housed += residents;
        participants += residents * (0.5 + 0.5 * holding.means);
    }
    participants += unplaced_street_workers(
        town.district.is_some().then_some(town.seat.story.people),
        housed,
    );
    // Each participating resident can supply the same share of street work in an epoch.
    let new_effort = participants * town.order.street_work * context.exposure;
    town.access_effort += new_effort;
    let opening = town.access_effort;
    let name = town.seat.name.clone();
    let trace = StreetTrace {
        enabled: std::env::var("ATLAS_TRACE_TOWN").is_ok_and(|v| v == name),
        name: &name,
        round: town.round + 1,
    };
    trace.event(|| {
        serde_json::json!({
            "stage": "start",
            "effort": town.access_effort,
            "holdings": town.holdings().len(),
            "streets": town.streets().len(),
            "frontages": context.candidates.len(),
            "exposure": context.exposure
        })
    });
    let initial_length = network_length(town);
    extend_approaches(town, context, &trace)?;
    super::crossroads::establish(town, context, &trace)?;
    let Traffic {
        widening,
        mut projects,
        paths,
        recurring,
        groups,
    } = traffic(town, context)?;
    projects.extend(backland(town));
    let fronts = crate::town::plots::OccupiedFronts::new(town);
    projects.extend(prospects(town, context, &fronts));
    projects.extend(occupied_ends(town, context)?);
    projects.extend(town.template.street_proposals(town));
    projects.extend(destinations(town, context)?);
    projects.extend(purpose_routes(town, context)?);
    let shortcuts = shortcuts(town, context, &fronts, &mut projects)?;
    let (route_count, path_count) = (projects.len(), paths.len());
    trace.event(|| {
        serde_json::json!({
            "stage": "proposed",
            "routes": projects.len(),
            "widenings": widening.len(),
            "outlying": context.outlying.len()
        })
    });
    // A way worn by walking is worth surfacing by its wear and by how much the town's
    // order values worn ways beside the streets it lays ahead of building.
    let worn = town.order.worn;
    let mut investments: Vec<_> = projects
        .into_iter()
        .map(|p| (p.benefit, Investment::Route(p)))
        .chain(
            paths
                .into_iter()
                .map(|p| (p.wear * worn, Investment::Surface(p))),
        )
        .chain(
            widening
                .into_iter()
                .map(|load| (load.value, Investment::Widen(load))),
        )
        .chain(
            context
                .outlying
                .iter()
                .enumerate()
                .map(|(i, (site, _))| (site.benefit, Investment::Settle(i))),
        )
        .collect();
    // hpc-exempt: orders spatial investments, not a lattice field.
    investments.sort_by(|a, b| b.0.total_cmp(&a.0));
    let Decisions {
        work,
        surfaces,
        deferred,
    } = undertake(town, context, &trace, investments, shortcuts, groups)?;
    if network_length(town) == initial_length && town.access_effort > 0. {
        seek_byway(town, context, &deferred, &trace)?;
    }
    if std::env::var("ATLAS_TRACE_STREET_WORK").is_ok_and(|v| v == "1" || v == name) {
        eprintln!(
            "{}",
            serde_json::json!({"event":"town.street-work","town":name,"round":town.round+1,
                "participants":participants,"newEffort":new_effort,"spent":opening-town.access_effort,
                "remaining":town.access_effort,"recurringStretches":recurring,
                "connectedPathProposals":path_count,"otherRouteProposals":route_count,
                "formalMetresAdded":network_length(town)-initial_length,"routeDecisions":work,"pathDecisions":surfaces})
        );
    }
    Ok(())
}
fn undertake(
    town: &mut Town,
    context: &mut Frontage<'_>,
    trace: &StreetTrace<'_>,
    investments: Vec<(f64, Investment)>,
    mut shortcuts: Option<BoundNetwork>,
    mut groups: Option<super::walks::passages::StreetGroups>,
) -> io::Result<Decisions> {
    let surveyed = town.streets().len();
    let mut recorded = surveyed;
    let mut work = StreetWork::default();
    let mut surfaces = StreetWork::default();
    let mut deferred = Vec::new();
    for (_, investment) in investments {
        if town.access_effort <= 0. && !matches!(investment, Investment::Settle(_)) {
            match investment {
                Investment::Surface(_) => surfaces.unfunded += 1,
                Investment::Route(_) => work.unfunded += 1,
                _ => {}
            }
            continue;
        }
        match investment {
            Investment::Settle(i) => {
                let (site, conditions) = context.outlying[i];
                let settled = site.settle(
                    town,
                    context.ground,
                    context.walking_ground,
                    context.spatial,
                    conditions,
                )?;
                trace.event(
                    || serde_json::json!({"stage":"outlying","candidate":i,"settled":settled}),
                );
            }
            Investment::Route(project) => {
                if project.joins_junctions
                    && recorded > surveyed
                    && shortcuts
                        .as_ref()
                        .is_some_and(|graph| shortcut_served(town, graph, &project))
                {
                    work.spacing += 1;
                    continue;
                }
                let decision = invest(town, context, &project, trace).map_err(|e| {
                    io::Error::other(format!(
                        "{} street proposal {:?}: {e}",
                        project.demand, project.points
                    ))
                })?;
                deferred.push(project);
                work.record(&decision);
            }
            Investment::Widen(load) => {
                let widened = town
                    .widen(load, context.ground, context.spatial)
                    .map_err(|e| {
                        io::Error::other(format!(
                            "Widening street {} at {}..{} m: {e}",
                            load.street, load.start, load.end
                        ))
                    })?;
                work.widened += usize::from(widened);
            }
            Investment::Surface(path) => {
                let decision =
                    surface_walk(town, context, &path, groups.as_mut()).map_err(|e| {
                        io::Error::other(format!(
                            "Surfacing {} course {:?}: {e}",
                            path.class.as_str(),
                            path.points
                        ))
                    })?;
                surfaces.record(&decision);
            }
        }
        if let Some(graph) = &mut shortcuts {
            for (i, road) in town.streets()[recorded..].iter().enumerate() {
                graph.add_public_street(recorded + i, road);
            }
            recorded = town.streets().len();
        }
    }
    Ok(Decisions {
        work,
        surfaces,
        deferred,
    })
}
struct Decisions {
    work: StreetWork,
    surfaces: StreetWork,
    deferred: Vec<Project>,
}
fn shortcut_served(town: &Town, graph: &BoundNetwork, project: &Project) -> bool {
    let (a, b) = (project.points[0], *project.points.last().unwrap());
    let slack = town.scale().length(SHORTCUT_SLACK, Measure::Layout);
    graph.junction_cost(a, b).is_some_and(|cost| {
        shortcut_gain(cost, distance(a, b), slack) <= town.order.shortcut_saving
    })
}
#[derive(Default, serde::Serialize)]
struct StreetWork {
    built: usize,
    unfunded: usize,
    terrain: usize,
    spacing: usize,
    claims: usize,
    widened: usize,
}
enum Decision {
    Built,
    Unfunded,
    Terrain,
    Spacing,
    Claim,
}
impl StreetWork {
    fn record(&mut self, decision: &Decision) {
        let count = match decision {
            Decision::Built => &mut self.built,
            Decision::Unfunded => &mut self.unfunded,
            Decision::Terrain => &mut self.terrain,
            Decision::Spacing => &mut self.spacing,
            Decision::Claim => &mut self.claims,
        };
        *count += 1;
    }
}
fn surface(
    town: &mut Town,
    context: &mut Frontage<'_>,
    path: &super::walks::LaneCourse,
) -> io::Result<Decision> {
    let form = town.street_form(path.class);
    let minimum = form.width();
    if town.access_effort < street_cost(minimum) {
        return Ok(Decision::Unfunded);
    }
    let course = path.alignment(context.spatial, context.ground, minimum / 2.)?;
    let network = StreetLines::near(
        town,
        &course,
        crate::town::settings::JUNCTION_TOLERANCE,
        context.spatial,
    )?;
    let depth = town.plot().1;
    let mut decision = Decision::Terrain;
    for section in std::iter::once(course.as_slice()).chain(path.junction_sections(&course)) {
        let mut points = section.to_vec();
        for _ in 0..2 {
            if let Some(mut street) = crate::town::network::lane(
                &points,
                form,
                context.ground,
                crate::town::network::stops_lane,
                minimum,
            ) {
                let complete = distance(*street.points.last().unwrap(), *points.last().unwrap())
                    <= crate::town::settings::JUNCTION_TOLERANCE;
                let attached = !network.is_empty() && network.attach_walk(&mut street.points)?;
                let length = street.length();
                if serves_walk(attached, complete, length, depth) {
                    match build(town, context, street.clone(), path.wear)? {
                        RoadInvestment::Built(_) => return Ok(Decision::Built),
                        RoadInvestment::TooExpensive(cost) => {
                            decision = Decision::Unfunded;
                            let affordable = length * town.access_effort / cost;
                            if affordable >= depth && affordable < length {
                                let mut points =
                                    crate::town::geometry::cut(&street.points, affordable);
                                let attached =
                                    !network.is_empty() && network.attach_walk(&mut points)?;
                                if serves_walk(attached, false, affordable, depth) {
                                    let portion = crate::town::network::Street::new_at(
                                        points, form.class, form.size, form.scale,
                                    );
                                    if matches!(
                                        build(town, context, portion, path.wear)?,
                                        RoadInvestment::Built(_)
                                    ) {
                                        return Ok(Decision::Built);
                                    }
                                }
                            }
                        }
                        RoadInvestment::Declined(_) => {
                            decision = Decision::Claim;
                            if complete {
                                break;
                            }
                        }
                    }
                } else {
                    decision = Decision::Spacing;
                    if complete {
                        break;
                    }
                }
            }
            points.reverse();
        }
    }
    Ok(decision)
}

fn surface_walk(
    town: &mut Town,
    context: &mut Frontage<'_>,
    path: &super::walks::LaneCourse,
    groups: Option<&mut super::walks::passages::StreetGroups>,
) -> io::Result<Decision> {
    let Some(ends) = path.joins else {
        return surface(town, context, path);
    };
    let groups = groups.ok_or_else(|| io::Error::other("Missing surveyed street components"))?;
    if groups.separate(ends, town, context.spatial)? {
        surface_connection(town, context, path)
    } else {
        Ok(Decision::Spacing)
    }
}

fn surface_connection(
    town: &mut Town,
    context: &mut Frontage<'_>,
    path: &super::walks::LaneCourse,
) -> io::Result<Decision> {
    let spatial = context.spatial;
    let from = path.points[0];
    let to = *path.points.last().unwrap();
    let Some(least) = connection_cost(
        town,
        &[from, to],
        path.class,
        street_cost(distance(from, to)),
        spatial,
    )?
    else {
        return Ok(Decision::Claim);
    };
    if least > town.access_effort {
        return Ok(Decision::Unfunded);
    }
    let Some(room) = spatial
        .buffer(&line(&path.points), town.plot().0)
        .map_err(io::Error::other)?
    else {
        return Ok(Decision::Terrain);
    };
    let widest = town.street_form(path.class).width();
    let atlas_map::Bounds(w, s, e, n) = spatial.bounds(&room).map_err(io::Error::other)?;
    let b = atlas_map::Bounds(w - widest, s - widest, e + widest, n + widest);
    let mut protected: Vec<_> = context.walking_ground.worked_fields(b).collect();
    for i in town.nearby_holdings(b, spatial)? {
        let h = &town.holdings()[i];
        if !h
            .slot
            .habitat
            .shares_surface(crate::town::templates::Habitat::Ground)
        {
            continue;
        }
        if h.public || h.land_claim() > 2. + path.wear {
            protected.push(&h.outline);
        } else {
            protected.extend(&h.buildings);
        }
    }
    let cropped = protected
        .into_iter()
        .map(|g| spatial.clip_by_rect(g, b))
        .collect::<Result<Vec<_>, _>>()
        .map_err(io::Error::other)?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let area = crate::town::byway::RightOfWay {
        corridor: room,
        obstacles: if cropped.is_empty() {
            None
        } else {
            spatial.union_all(&cropped).map_err(io::Error::other)?
        },
    };
    let mut answer = Decision::Terrain;
    for class in
        std::iter::once(path.class).chain((path.class == Class::Lane).then_some(Class::Alley))
    {
        let form = town.street_form(class);
        let Some(points) = crate::town::byway::walked_connection(
            &path.points,
            form.width(),
            &area,
            context.walking_ground,
            context.ground,
            spatial,
        )?
        else {
            continue;
        };
        let road = crate::town::network::Street::new_at(points, class, form.size, form.scale);
        let result = build(town, context, road, path.wear)?;
        answer = result.decision();
        if matches!(result, RoadInvestment::Built(_)) {
            break;
        }
    }
    Ok(answer)
}

/// A short link can close an existing connection. An interrupted course
/// must open usable frontage. Beyond the paved network, recurring journeys
/// shared by households can support a public way along a whole block.
fn serves_walk(attached: bool, complete: bool, length: f64, plot_depth: f64) -> bool {
    if attached {
        complete || length >= plot_depth
    } else {
        length >= 2. * plot_depth
    }
}

fn purpose_routes(town: &Town, context: &Frontage<'_>) -> io::Result<Vec<Project>> {
    let mut projects = Vec::new();
    for purpose in town.purposes() {
        for rel in &purpose.relationships {
            let Relationship::Access { from, to, use_ } = *rel else {
                continue;
            };
            if rel.satisfied(purpose.site, town, context.spatial)? {
                continue;
            }
            if let (Some(class), Some(target)) =
                (use_.street_class(), town.access_destinations(to).next())
            {
                projects.push(Project {
                    demand: "purpose",
                    joins_junctions: false,
                    points: vec![town.position(from), target],
                    benefit: 1. + purpose.investment,
                    class,
                });
            }
        }
    }
    Ok(projects)
}

fn network_length(town: &Town) -> f64 {
    town.streets().iter().map(|s| s.length()).sum()
}

fn seek_byway(
    town: &mut Town,
    context: &mut Frontage<'_>,
    projects: &[Project],
    trace: &StreetTrace<'_>,
) -> io::Result<()> {
    if town.streets().is_empty() || projects.is_empty() {
        return Ok(());
    }
    let roads: Vec<_> = town.streets().iter().map(|s| line(&s.points)).collect();
    let index = context.spatial.index(&roads).map_err(io::Error::other)?;
    let size = town.seat.story.size();
    let scale = town.scale();
    let (frontage, depth) = town.plot();
    let reach = (depth * 2.5).min(town.access_effort * 2.);
    for project in projects {
        let from = project.points[0];
        let to = *project.points.last().unwrap();
        let p = Position::xy(from[0], from[1]);
        let Some(id) = index.nearest(p).map_err(io::Error::other)? else {
            continue;
        };
        let class = if project.class == Class::Lane {
            Class::Alley
        } else {
            project.class
        };
        let target = Position::xy(to[0], to[1]);
        let Some(nearest) = index.nearest(target).map_err(io::Error::other)? else {
            continue;
        };
        let unserved_distance = context
            .spatial
            .distance(
                &roads[nearest],
                &Geometry::Point {
                    coordinates: target,
                },
            )
            .map_err(io::Error::other)?;
        let journey = crate::town::byway::Journey {
            departure: from,
            destination: to,
            unserved_distance,
        };
        let Some(path) = crate::town::byway::course(
            &town.streets()[id],
            journey,
            context.ground,
            scale.street_width(class, size),
            reach,
            frontage,
        ) else {
            continue;
        };
        let street = crate::town::network::Street::new_at(path, class, size, scale);
        let end = street.points.last().copied();
        let length = street.length();
        let width = street.width();
        if matches!(
            build(town, context, street, project.benefit)?,
            RoadInvestment::Built(_)
        ) {
            trace.event(|| serde_json::json!({"stage":"byway","result":"built","demand":project.demand,"destination":to,"end":end,"length":length,"width":width}));
            break;
        }
    }
    Ok(())
}

/// Occupied frontage can carry its way farther into the countryside. Follow the
/// captured course without installing its whole urban street at foundation.
fn extend_approaches(
    town: &mut Town,
    context: &mut Frontage<'_>,
    trace: &StreetTrace<'_>,
) -> io::Result<()> {
    use crate::town::geometry::{line_length, rest};
    use crate::town::network::{main_street, Arm};
    let size = town.seat.story.size();
    let scale = town.scale();
    let depth = town.plot().1;
    // How far along each street its holdings reach, gathered once; extending a street
    // does not move holdings.
    let mut occupied = vec![f64::NEG_INFINITY; town.streets().len()];
    for h in town.holdings() {
        if let Some(reach) = h.slot.street.and_then(|s| occupied.get_mut(s)) {
            *reach = reach.max(h.slot.along + 2. * h.slot.depth);
        }
    }
    for (arm, street_id) in town.growing_ways().to_vec() {
        let street = &town.streets()[street_id];
        let length = street.length();
        let end = *street.points.last().unwrap();
        let inhabited = occupied
            .get(street_id)
            .is_some_and(|reach| *reach >= length);
        // A commissioned country crossing and an approach to a named destination
        // still serve travellers beyond the last inhabited plot.
        let serves_country = street.class == Class::Street || arm.destination.is_some();
        if street.through_route || !(inhabited || serves_country) {
            trace.event(|| serde_json::json!({"stage":"approach","id":street_id,"through":street.through_route,"inhabited":inhabited,"serves_country":serves_country}));
            continue;
        }
        let path = line(&arm.points);
        let fraction = context
            .spatial
            .line_fraction(&path, Position::xy(end[0], end[1]))
            .map_err(io::Error::other)?;
        let mut tail = rest(&arm.points, fraction * line_length(&arm.points));
        if tail.len() < 2 {
            trace.event(
                || serde_json::json!({"stage":"approach","id":street_id,"result":"end of course"}),
            );
            continue;
        }
        tail[0] = end;
        let remaining = line_length(&tail);
        let goal = Arm {
            points: tail,
            destination: arm.destination.clone(),
        };
        let reach = (2.5 * depth).min(2. * town.access_effort);
        if reach < crate::town::network::vertex_step(scale) {
            trace.event(|| serde_json::json!({"stage":"approach","id":street_id,"result":"insufficient reach","reach":reach}));
            continue;
        }
        if let Some(mut extension) = main_street(&goal, reach, size, context.ground, scale) {
            let cost = street_cost(extension.length());
            extension.class = street.class;
            extension
                .widths
                .fill(if inhabited && street.class == Class::Main {
                    scale.street_width(Class::Main, size)
                } else {
                    scale.street_width(Class::Road, size)
                });
            extension.through_route &= remaining <= extension.length() + context.ground.cell
                || context.ground.owner(*extension.points.last().unwrap())
                    == crate::town::ground::OUTSIDE;
            let points = extension.points.clone();
            let width = extension.width();
            let extended = town.extend_street(street_id, extension, context.spatial)?;
            trace.event(|| serde_json::json!({"stage":"approach","id":street_id,"extended":extended,"destination":points.last(),"cost":cost}));
            if extended {
                town.access_effort -= cost;
                context.ground.take_line(
                    &points,
                    width + context.ground.cell,
                    FIRST_STREET + street_id as u32,
                );
            }
        } else {
            trace.event(|| serde_json::json!({"stage":"approach","id":street_id,"result":"course too short on ground","reach":reach}));
        }
    }
    Ok(())
}
/// A built-up street can still grow around a hillside when it has no plot
/// left from which to propose a side lane. Compare the buildable banks ahead.
fn occupied_ends(town: &Town, context: &Frontage<'_>) -> io::Result<Vec<Project>> {
    use crate::town::{
        geometry::{angle, heading, rectangle},
        ground::{Rectangle, FREE},
        network::{lane, stops_lane},
    };
    let pad = town.scale().length(END_PAD, Measure::Layout);
    let form = town.street_form(Class::Lane);
    let (frontage, depth) = town.plot();
    let mut projects = Vec::new();
    for (id, road) in town.streets().iter().enumerate() {
        let Some(pair) = road.points.last_chunk::<2>() else {
            continue;
        };
        if road.through_route {
            continue;
        }
        // A holding's front lies on its outline, so the holdings index finds the fronts
        // near the street's end.
        let [x, y] = pair[1];
        let near = depth * 2. + pad;
        let ends_occupied = town
            .nearby_holdings(
                atlas_map::Bounds(x - near, y - near, x + near, y + near),
                context.spatial,
            )?
            .into_iter()
            .map(|i| &town.holdings()[i])
            .any(|h| h.slot.street == Some(id) && distance(h.slot.front, pair[1]) < depth * 2.);
        if !ends_occupied {
            continue;
        }
        let direction = angle(sub(pair[1], pair[0]));
        let best = [0., -0.5, 0.5, -1., 1.]
            .into_iter()
            .filter_map(|turn| {
                let axis = heading(direction + turn);
                let end = add(pair[1], scale(axis, depth * 2.));
                let lane = lane(
                    &[pair[1], end],
                    form,
                    context.ground,
                    stops_lane,
                    frontage * 1.5,
                )?;
                let tip = *lane.points.last()?;
                let land = [-1., 1.]
                    .into_iter()
                    .filter(|side| {
                        let bank = scale(left(axis), *side);
                        let front = add(tip, scale(bank, lane.width() * 0.5));
                        context.ground.open(
                            &Rectangle(&rectangle(front, axis, bank, frontage, depth)),
                            FREE,
                        )
                    })
                    .count();
                (land > 0).then(|| Project {
                    demand: "occupied street end",
                    joins_junctions: false,
                    class: Class::Lane,
                    points: vec![pair[1], tip],
                    benefit: land as f64 / (1. + turn.abs()),
                })
            })
            .max_by(|a, b| a.benefit.total_cmp(&b.benefit));
        projects.extend(best);
    }
    Ok(projects)
}
fn prospects(
    town: &Town,
    context: &Frontage<'_>,
    fronts: &crate::town::plots::OccupiedFronts,
) -> Vec<Project> {
    let housed = town
        .holdings()
        .iter()
        .filter(|h| h.kind.definition().roles.dwelling)
        .count() as f64;
    let town_scale = town.scale();
    let pressure = town.seat.story.people
        / (town.seat.story.people + housed * PEOPLE_PER_HOME * town_scale.premises() + 1.);
    let centre_pull = town_scale.length(CENTRE_PULL, Measure::Adjacency);
    context
        .candidates
        .iter()
        .filter(|c| {
            c.slot.street.is_some_and(|street| {
                fronts.flanks_opening(&c.slot)
                    && context.ground.open(
                        &crate::town::ground::Rectangle(&c.slot.corners),
                        FIRST_STREET + street as u32,
                    )
            })
        })
        .map(|c| {
            let start = c.slot.front;
            // The town's own bearing: the way its first approach comes in, or, where no
            // approach enters, the way its oldest street runs.
            let axis = town
                .seat
                .arms
                .first()
                .map(|arm| arm.points.as_slice())
                .or_else(|| {
                    town.streets()
                        .first()
                        .map(|street| street.points.as_slice())
                })
                .and_then(|points| points.windows(2).next())
                .map_or(c.slot.direction, |leg| unit(sub(leg[1], leg[0])));
            let order = town.order;
            let (direction, priority) = street_bearing(
                (town.layout, order.alignment()),
                axis,
                sub(start, town.seat.centre),
                c.slot.inward,
                c.slot.depth,
            );
            // Open access to the rear of the occupied row. Its new frontage can
            // support an extension once premises actually reach that street end. A town
            // that surveys ahead lays a longer run and values it more; the run still has
            // to win its effort from every other street work.
            let end = add(start, scale(direction, c.slot.depth * order.survey.max(1.)));
            let focal = 1. / (1. + distance(start, town.seat.centre) / centre_pull);
            let demand = c.opportunities.for_activity(Activity::Household).demand;
            Project {
                demand: "prospective frontage",
                joins_junctions: false,
                class: Class::Lane,
                points: vec![start, end],
                benefit: order.survey * priority * (pressure * 3. * focal + demand / (1. + demand)),
            }
        })
        .collect()
}
/// Choose the bearing for new frontage. Connections to an existing destination retain its position.
/// A town with no layout of its own lets each street run the way its plot faces, turned
/// toward the town's bearing by `alignment`: not at all at zero, wholly at one.
fn street_bearing(
    (layout, alignment): (Layout, f64),
    axis: Point,
    from_centre: Point,
    outward: Point,
    depth: f64,
) -> (Point, f64) {
    let aligned = |axis: Point| {
        let perpendicular = left(axis);
        let direction = if dot(axis, outward).abs() > dot(perpendicular, outward).abs() {
            axis
        } else {
            perpendicular
        };
        scale(
            direction,
            if dot(direction, outward) < 0. {
                -1.
            } else {
                1.
            },
        )
    };
    match layout {
        Layout::Grid => (aligned(axis), 1.),
        Layout::Radial => (aligned(unit(from_centre)), 1.),
        Layout::Linear => (
            aligned(axis),
            1. / (1. + dot(from_centre, left(axis)).abs() / (2. * depth)),
        ),
        Layout::Walled => (
            aligned(unit(from_centre)),
            1. / (1. + crate::town::geometry::length(from_centre) / (4. * depth)),
        ),
        Layout::Organic => (
            unit(add(
                scale(outward, 1. - alignment),
                scale(aligned(axis), alignment),
            )),
            1.,
        ),
    }
}
struct Traffic {
    widening: Vec<StreetLoad>,
    projects: Vec<Project>,
    paths: Vec<super::walks::LaneCourse>,
    recurring: usize,
    groups: Option<super::walks::passages::StreetGroups>,
}
fn foot_doors(town: &Town, mode: AccessUse) -> Vec<Entrance> {
    if mode != AccessUse::Foot {
        return Vec::new();
    }
    town.holdings()
        .iter()
        .map(|h| {
            if h.slot.street.is_none() || h.access_via.is_some() {
                Entrance::independent(h.slot.front)
            } else {
                Entrance::holding(town, h)
            }
        })
        .collect()
}
fn traffic(town: &mut Town, context: &Frontage<'_>) -> io::Result<Traffic> {
    let mut access = Access::for_town(town, context.spatial)?.on_ground(context.walking_ground);
    for &(a, b, cost) in context.links {
        access.add_link(a, b, cost, context.spatial)?;
    }
    let mut unmet = Vec::new();
    // Sources keyed by endpoint, in their original order, so each operating tie finds its
    // hpc-exempt: counterparty without scanning every source.
    let mut by_endpoint = std::collections::BTreeMap::<_, Vec<_>>::new();
    for source in context.sources {
        by_endpoint
            .entry(&source.endpoint)
            .or_default()
            .push(source);
    }
    let mut walks = super::walks::Walks::new(town, context.walking_ground);
    // hpc-exempt: named street stretches retain the loads of routed journeys.
    let mut use_ = std::collections::BTreeMap::<Stretch, f64>::new();
    for mode in [AccessUse::Foot, AccessUse::Freight, AccessUse::Waterborne] {
        let mut locations = foot_doors(town, mode);
        // hpc-exempt: a counterparty binds once for this mode.
        let mut destinations = std::collections::BTreeMap::new();
        // hpc-exempt: reuse each counterparty's route tree across all its travellers.
        let mut travellers = TripOrigins::new();
        for (h, tie, share) in town
            .holdings()
            .iter()
            .filter(|h| h.occupation > 0.)
            .flat_map(|h| h.operating_shares().map(move |(t, s)| (h, t, s)))
            .filter(|(_, t, _)| t.access == mode)
        {
            let Some(source) = by_endpoint.get(&tie.destination).and_then(|sources| {
                sources.iter().copied().find(|s| {
                    s.demand + s.capability > 0.
                        && if tie.productive.is_some() {
                            s.productive == tie.productive
                        } else if let Some(group) = tie.clientele {
                            s.clientele == Some(group)
                        } else {
                            s.productive.is_none() && tie.purpose.offered_by(s.activity)
                        }
                })
            }) else {
                continue;
            };
            let origin = *destinations.entry(&source.endpoint).or_insert_with(|| {
                if let crate::town::fabric::Endpoint::Premises { town: key, holding } =
                    &source.endpoint
                {
                    if mode == AccessUse::Foot && *key == town.seat.key {
                        return holding.0 as usize;
                    }
                }
                let i = locations.len();
                locations.push(Entrance::source(town, &source.endpoint, source.position));
                i
            });
            let target = if mode == AccessUse::Foot {
                h.id.0 as usize
            } else {
                locations.push(Entrance::holding(town, h));
                locations.len() - 1
            };
            travellers.entry(origin).or_default().push((
                target,
                h.id,
                if tie.clientele.is_some() {
                    tie.strength
                } else {
                    h.occupation * share * (1. + h.kind.definition().demand)
                },
                h.slot.front,
                source.position,
            ));
        }
        if locations.is_empty() {
            continue;
        }
        let graph = access.bind(&locations, mode, context.spatial)?;
        if mode == AccessUse::Foot {
            daily_walks(town, &graph, &mut walks);
        }
        route_journeys(&graph, travellers, mode, &mut use_, &mut walks, &mut unmet);
    }
    let loads = street_loads(town, context, &use_)?;
    town.register_traffic(loads.clone(), context.exposure);
    town.recognise_high_street();
    let (mut paths, worn) = walks.finish(town);
    let groups = super::walks::passages::propose(town, &worn, context.spatial, &mut paths)?;
    Ok(Traffic {
        widening: loads,
        projects: unmet,
        paths,
        recurring: worn.len(),
        groups,
    })
}
fn route_journeys(
    graph: &BoundNetwork,
    travellers: TripOrigins,
    mode: AccessUse,
    use_: &mut Loads,
    walks: &mut super::walks::Walks,
    unmet: &mut Vec<Project>,
) {
    for (origin, trips) in travellers {
        let routes = graph.routes_to(origin, trips.iter().map(|trip| trip.0));
        for (target, holding, load, from, to) in trips {
            if routes.cost(target).is_finite() {
                let mut previous = None;
                routes.course(target, |course, a, b| {
                    if matches!(
                        (previous, course),
                        (Some(Course::Walk), Course::Street(_))
                            | (Some(Course::Street(_)), Course::Walk)
                    ) {
                        walks.junction(a);
                    }
                    match course {
                        Course::Walk => walks.visit(holding, load, a, b, true),
                        Course::Street(s) => *use_.entry(s).or_default() += load,
                        Course::Link => {}
                    }
                    previous = Some(course);
                });
            } else if let Some(class) = mode.street_class() {
                unmet.push(Project {
                    demand: "unrouted journey",
                    joins_junctions: false,
                    class,
                    points: vec![from, to],
                    benefit: load,
                });
            }
        }
    }
}
fn daily_walks(town: &Town, graph: &BoundNetwork, walks: &mut super::walks::Walks) {
    let streets = graph.to_streets();
    let centre = town
        .holdings()
        .iter()
        .filter(|h| h.occupation > 0.)
        .max_by(|a, b| {
            let draw = |h: &crate::town::fabric::Holding| {
                h.occupation * (1. + h.kind.definition().prominence)
            };
            draw(a).total_cmp(&draw(b))
        })
        .map(|h| graph.routes(h.id.0 as usize));
    for h in town
        .holdings()
        .iter()
        .filter(|h| h.occupation > 0. && (h.slot.street.is_none() || h.access_via.is_some()))
    {
        let i = h.id.0 as usize;
        if let Some(approach) = streets.approach(i) {
            for leg in approach.points.windows(2) {
                walks.visit(h.id, h.occupation, leg[0], leg[1], false);
            }
            if let Some(&junction) = approach.points.last() {
                walks.junction(junction);
            }
            walks.approaches[i] = Some(approach);
        } else if let Some(routes) = &centre {
            let mut destination = None;
            let mut on_foot = true;
            routes.course(i, |c, a, b| {
                if matches!(c, Course::Walk) {
                    walks.visit(h.id, h.occupation, a, b, false);
                    destination = Some(b);
                } else {
                    on_foot = false;
                }
            });
            if on_foot && town.streets().is_empty() {
                if let Some(point) = destination {
                    walks.junction(point);
                }
            }
        }
    }
}
// hpc-exempt: group journeys by a bound destination entrance to share its shortest paths.
type TripOrigins = std::collections::BTreeMap<
    usize,
    Vec<(usize, crate::town::fabric::HoldingId, f64, Point, Point)>,
>;
// hpc-exempt: measure routed use by named street stretch.
type Loads = std::collections::BTreeMap<Stretch, f64>;
fn street_loads(town: &Town, context: &Frontage<'_>, use_: &Loads) -> io::Result<Vec<StreetLoad>> {
    let mut loads = Vec::new();
    // Stretches order by street first, so each street's stretches are one run.
    let used: Vec<_> = use_.iter().collect();
    for stretches in used.chunk_by(|a, b| a.0.street == b.0.street) {
        let street = stretches[0].0.street;
        let Some(road) = town.streets().get(street) else {
            continue;
        };
        let points: Vec<_> = stretches
            .iter()
            .flat_map(|(s, _)| [s.from.point(), s.to.point()])
            .map(|[x, y]| Position::xy(x, y))
            .collect();
        let measures = context
            .spatial
            .line_fractions(&line(&road.points), &points)
            .map_err(io::Error::other)?;
        let length = road.length();
        for ((_, value), m) in stretches.iter().zip(measures.as_chunks::<2>().0) {
            loads.push(StreetLoad {
                street,
                start: m[0].min(m[1]) * length,
                end: m[0].max(m[1]) * length,
                value: **value,
            });
        }
    }
    Ok(loads)
}
fn backland(town: &Town) -> Vec<Project> {
    let town_scale = town.scale();
    let offset = town_scale.length(BACKLAND_OFFSET, Measure::Layout);
    let behind = town_scale.length(town.order.back_lane, Measure::Layout);
    let deep = town_scale.length(DEEP_PLOT, Measure::Plot);
    let centre_pull = town_scale.length(CENTRE_PULL, Measure::Adjacency);
    town.holdings()
        .iter()
        .filter(|h| h.slot.street.is_some() && (h.occupation > 0.2 || h.public))
        .map(|h| {
            let flank = scale(h.slot.direction, h.slot.frontage / 2. + offset);
            let start = add(add(h.slot.front, flank), scale(h.slot.inward, -offset));
            let rear = add(
                add(h.slot.front, flank),
                scale(h.slot.inward, h.slot.depth + behind),
            );
            let lateral = match town.layout {
                Layout::Radial => 0.,
                Layout::Linear => h.slot.depth * 1.5,
                _ => h.slot.frontage * 2.,
            };
            let end = add(rear, scale(h.slot.direction, lateral));
            Project {
                demand: "occupied backland",
                joins_junctions: false,
                class: Class::Lane,
                points: vec![start, rear, end],
                benefit: (0.3 + h.occupation + h.crowding + h.kind.definition().prominence)
                    / (1. + h.slot.depth / deep)
                    * (0.3 + 1. / (1. + distance(h.slot.front, town.seat.centre) / centre_pull)),
            }
        })
        .collect()
}
fn destinations(town: &Town, context: &Frontage<'_>) -> io::Result<Vec<Project>> {
    let roads: Vec<_> = town.streets().iter().map(|s| line(&s.points)).collect();
    if roads.is_empty() {
        return Ok(vec![]);
    }
    let index = context.spatial.index(&roads).map_err(io::Error::other)?;
    let mut result = Vec::new();
    for source in context.sources {
        // Premises generate journeys through their operating ties. Their presence
        // alone cannot commission a road across the intervening land.
        if !matches!(
            source.endpoint,
            crate::town::fabric::Endpoint::External(_) | crate::town::fabric::Endpoint::Field(_)
        ) || source.demand + source.capability <= 0.
        {
            continue;
        }
        let p = Position::xy(source.position[0], source.position[1]);
        let Some(i) = index.nearest(p).map_err(io::Error::other)? else {
            continue;
        };
        let [start, _] = context
            .spatial
            .nearest_points(&roads[i], &Geometry::Point { coordinates: p })
            .map_err(io::Error::other)?;
        let [x, y, _] = start.coordinates();
        if distance([x, y], source.position) <= town.streets()[i].width() / 2. {
            continue;
        }
        result.push(Project {
            demand: "destination",
            joins_junctions: false,
            class: Class::Lane,
            points: vec![[x, y], source.position],
            benefit: source.demand / (1. + source.demand)
                + source.capability / (1. + source.capability),
        });
    }
    Ok(result)
}
fn shortcuts(
    town: &Town,
    context: &Frontage<'_>,
    fronts: &crate::town::plots::OccupiedFronts,
    projects: &mut Vec<Project>,
) -> io::Result<Option<BoundNetwork>> {
    let (width, depth) = town.plot();
    let (ends, frontage): (Vec<_>, Vec<_>) = town
        .streets()
        .iter()
        .enumerate()
        .flat_map(|(i, s)| {
            [(s.points[0], 0.), (*s.points.last().unwrap(), s.length())]
                .map(|(p, station)| (p, fronts.served_front(i, station, depth)))
        })
        .filter(|(_, occupied)| *occupied > 0.)
        .unzip();
    if ends.len() < 2 {
        return Ok(None);
    }
    let mut edges = context
        .spatial
        .delaunay_edges(
            &ends
                .iter()
                .map(|p| Position::xy(p[0], p[1]))
                .collect::<Vec<_>>(),
        )
        .map_err(io::Error::other)?;
    if ends.len() == 2 {
        edges = vec![[0, 1]];
    }
    let mut access = Access::for_town(town, context.spatial)?.on_ground(context.walking_ground);
    for &(a, b, cost) in context.links {
        access.add_link(a, b, cost, context.spatial)?;
    }
    let entrances: Vec<_> = ends.iter().copied().map(Entrance::external).collect();
    let network = access.bind(&entrances, AccessUse::Foot, context.spatial)?;
    let mut neighbours = vec![Vec::new(); ends.len()];
    let layout = |metres| town.scale().length(metres, Measure::Layout);
    let (least, slack) = (layout(SHORTCUT_LEAST), layout(SHORTCUT_SLACK));
    for [a, b] in edges {
        if distance(ends[a], ends[b]) >= least {
            neighbours[a].push(b);
        }
    }
    let before = projects.len();
    for (a, adjacent) in neighbours.iter().enumerate().filter(|(_, v)| !v.is_empty()) {
        let routes = network.routes_to(a, adjacent.iter().copied());
        for &b in adjacent {
            let direct = distance(ends[a], ends[b]);
            let cost = routes.cost(b);
            let terms = (slack, town.order.shortcut_saving);
            if let Some(benefit) =
                shortcut_benefit(cost, direct, terms, frontage[a].min(frontage[b]), width)
            {
                projects.push(Project {
                    demand: "shortcut",
                    joins_junctions: true,
                    class: Class::Lane,
                    points: vec![ends[a], ends[b]],
                    benefit,
                });
            }
        }
    }
    Ok((projects.len() > before).then_some(network))
}
fn shortcut_gain(cost: f64, direct: f64, slack: f64) -> f64 {
    (cost - direct) / (direct + slack)
}
/// What joining two street ends is worth: nothing unless it saves more than `saving` of
/// the walk between them and serves occupied frontage.
fn shortcut_benefit(
    cost: f64,
    direct: f64,
    (slack, saving): (f64, f64),
    served: f64,
    plot_width: f64,
) -> Option<f64> {
    let gain = shortcut_gain(cost, direct, slack);
    (gain.is_finite() && gain > saving && served > 0.).then_some(gain * (1. + served / plot_width))
}
fn invest(
    town: &mut Town,
    context: &mut Frontage<'_>,
    project: &Project,
    trace: &StreetTrace<'_>,
) -> io::Result<Decision> {
    let from = project.points.first().copied();
    let to = project.points.last().copied();
    let decision = |result: &str, cost: Option<f64>, effort: f64| {
        trace.event(|| {
            serde_json::json!({
                "stage": "route",
                "demand": project.demand,
                "from": from,
                "to": to,
                "benefit": project.benefit,
                "result": result,
                "effort": effort,
                "cost": cost
            })
        });
    };
    let scale = town.scale();
    let minimum_route = scale.length(MINIMUM_ROUTE, Measure::Layout);
    let minimum = connection_cost(
        town,
        &project.points,
        project.class,
        street_cost(minimum_route),
        context.spatial,
    )?;
    let Some(minimum) = minimum else {
        return Ok(Decision::Claim);
    };
    if town.access_effort < minimum {
        decision(
            "insufficient effort for minimum corridor",
            Some(minimum),
            town.access_effort,
        );
        return Ok(Decision::Unfunded);
    }
    let mut points = project.points.clone();
    if !town.streets().is_empty() {
        let Some((_, start)) = town.project_onto_road(points[0], context.spatial)? else {
            return Ok(Decision::Spacing);
        };
        points[0] = start;
        if let [a, b] = points.as_mut_slice() {
            let spacing = scale.length(town.order.street_spacing, Measure::Layout);
            let streets = StreetLines::near(
                town,
                &[*a, *b],
                spacing * crate::town::settings::JOIN_SHARE,
                context.spatial,
            )?;
            let Some((end, _)) = streets.constrain(&[*a, *b], spacing)? else {
                decision("network spacing or overlap", None, town.access_effort);
                return Ok(Decision::Spacing);
            };
            *b = end;
        }
    }
    let dry = crate::town::network::lane(
        &points,
        town.street_form(project.class),
        context.ground,
        crate::town::network::stops_lane,
        minimum_route,
    );
    let across = crossing_lane(town, context, project.class, &points, minimum_route)?;
    let Some(street) = across
        .filter(|route| dry.as_ref().is_none_or(|d| route.length() > d.length()))
        .or(dry)
        .filter(|street| {
            !project.joins_junctions
                || street.points.last().zip(to).is_some_and(|(&end, target)| {
                    distance(end, target) <= crate::town::settings::JUNCTION_TOLERANCE
                })
        })
    else {
        decision(
            "less than the minimum usable corridor",
            None,
            town.access_effort,
        );
        return Ok(Decision::Terrain);
    };
    let effort = town.access_effort;
    let purchase = build(town, context, street, project.benefit)?;
    let (label, cost) = match purchase {
        RoadInvestment::Built(cost) => ("built", cost),
        RoadInvestment::TooExpensive(cost) => ("insufficient effort", cost),
        RoadInvestment::Declined(cost) => ("land claim declined", cost),
    };
    decision(label, Some(cost), effort);
    Ok(purchase.decision())
}

fn crossing_lane(
    town: &Town,
    context: &Frontage<'_>,
    class: Class,
    points: &[Point],
    minimum: f64,
) -> io::Result<Option<crate::town::network::Street>> {
    use crate::town::{
        ground::WATER,
        network::{bridge_span, lane, stops_lane},
    };
    if context.ground.wet_runs(points).is_empty() {
        return Ok(None);
    }
    let Some(mut course) = lane(
        points,
        town.street_form(class),
        context.ground,
        |owner| owner != WATER && stops_lane(owner),
        minimum,
    ) else {
        return Ok(None);
    };
    let span = bridge_span(town.seat.story.size(), town.scale());
    if !crate::processes::ground::crossings::survey(
        &mut course,
        context.ground,
        span,
        context.channel_depth,
    )? {
        return Ok(None);
    }
    let cost = street_cost(course.length()) + bridge_effort(&course);
    Ok((cost <= town.access_effort).then_some(course))
}

fn bridge_effort(street: &crate::town::network::Street) -> f64 {
    street
        .bridges
        .iter()
        .map(|(a, b)| (b - a) * street.width())
        .sum()
}
enum RoadInvestment {
    Built(f64),
    TooExpensive(f64),
    Declined(f64),
}
impl RoadInvestment {
    fn decision(&self) -> Decision {
        match self {
            Self::Built(_) => Decision::Built,
            Self::TooExpensive(_) => Decision::Unfunded,
            Self::Declined(_) => Decision::Claim,
        }
    }
}
fn build(
    town: &mut Town,
    context: &mut Frontage<'_>,
    street: crate::town::network::Street,
    benefit: f64,
) -> io::Result<RoadInvestment> {
    let ordinary = street_cost(street.length()) + bridge_effort(&street);
    let Some(cost) = connection_cost(
        town,
        &street.points,
        street.class,
        ordinary,
        context.spatial,
    )?
    else {
        return Ok(RoadInvestment::Declined(ordinary));
    };
    if cost > town.access_effort {
        return Ok(RoadInvestment::TooExpensive(cost));
    }
    let corridor = context
        .spatial
        .buffer(&line(&street.points), street.width() / 2.)
        .map_err(io::Error::other)?;
    if matches!(
        town.apply(
            FabricEdit::Connect {
                street: street.clone(),
                priority: 2. + benefit
            },
            context.spatial
        )?,
        EditOutcome::Declined
    ) {
        return Ok(RoadInvestment::Declined(cost));
    }
    if let Some(corridor) = corridor {
        context
            .ground
            .release_shape(&corridor, PLOT, context.spatial)?;
    }
    context.ground.take_line(
        &street.points,
        street.width() + context.ground.cell,
        FIRST_STREET + town.streets().len() as u32 - 1,
    );
    town.access_effort -= cost;
    Ok(RoadInvestment::Built(cost))
}

fn connection_cost(
    town: &Town,
    points: &[Point],
    class: Class,
    ordinary: f64,
    spatial: &dyn crate::spatial::SpatialKernel,
) -> io::Result<Option<f64>> {
    use crate::town::effects::{Placement, Requirement};
    let target = Placement::Access(if matches!(class, Class::Lane | Class::Alley) {
        AccessUse::Foot
    } else {
        AccessUse::Freight
    });
    let mut cost = ordinary;
    for &endpoint in points.first().into_iter().chain(points.last()) {
        let influence = town.placement_at(endpoint, spatial)?;
        if !influence.permitted(target) {
            return Ok(None);
        }
        cost = cost.min(influence.requirement(target, Requirement::ConnectionCost, ordinary));
    }
    let least = street_cost(town.scale().length(LEAST_CONNECTION, Measure::Layout));
    Ok(Some(cost.max(least)))
}
/// The street work, in effort, a way this many true metres long takes. Effort is spent per
/// true metre at every fidelity, as the economy reads true floor areas.
fn street_cost(length: f64) -> f64 {
    length * 0.5
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processes::town::walks::LaneCourse;
    use crate::town::{
        ground::{Ground, WATER},
        network::Street,
        seat::Seat,
        story::Story,
    };

    #[test]
    fn a_districts_people_share_in_street_work_before_this_map_houses_them() {
        // A town has the street work of the residents it has housed and no more.
        assert_eq!(unplaced_street_workers(None, 300.), 0.);
        // A district of eleven thousand with three hundred housed has the rest at half a
        // share each; once all are housed there is nobody left to add.
        assert_eq!(unplaced_street_workers(Some(11_000.), 300.), 5_350.);
        assert_eq!(unplaced_street_workers(Some(11_000.), 11_000.), 0.);
        assert_eq!(unplaced_street_workers(Some(11_000.), 12_500.), 0.);
    }

    fn assert_built(town: &mut Town, context: &mut Frontage<'_>, course: &LaneCourse) {
        assert!(matches!(
            surface(town, context, course).unwrap(),
            Decision::Built
        ));
    }
    #[test]
    fn a_surveying_town_turns_new_frontage_toward_its_own_bearing() {
        // A town with no layout of its own, whose main way runs east. A plot facing
        // north-east opens a street behind it.
        let (axis, facing) = ([1., 0.], unit([1., 0.6]));
        let bearing = |alignment: f64| {
            street_bearing((Layout::Organic, alignment), axis, [50., 30.], facing, 25.).0
        };
        // Unsurveyed, the street runs the way the plot faces.
        assert_eq!(bearing(0.), facing);
        // The more the town surveys, the nearer the street runs to the town's bearing.
        let along = |direction: Point| dot(direction, axis);
        assert!(along(bearing(0.5)) > along(bearing(0.)));
        assert!(along(bearing(0.9)) > along(bearing(0.5)));
        assert!((along(bearing(1.)) - 1.).abs() < 1e-12);
        // A town laid out as a grid keeps its bearing whatever it surveys.
        let grid = street_bearing((Layout::Grid, 0.), axis, [50., 30.], facing, 25.).0;
        assert_eq!(grid, axis);
    }
    #[test]
    fn shortcuts_need_a_real_detour_and_people_at_both_ends() {
        let usual = (40., crate::town::order::Order::default().shortcut_saving);
        assert_eq!(shortcut_benefit(f64::INFINITY, 100., usual, 12., 10.), None);
        assert_eq!(shortcut_benefit(300., 100., usual, 0., 10.), None);
        assert_eq!(shortcut_benefit(120., 100., usual, 12., 10.), None);
        assert!(shortcut_benefit(300., 100., usual, 12., 10.).is_some());
        // A town that joins street ends for any saving builds the shortcut the usual town
        // leaves, and one that wants the walk halved leaves a shortcut the usual town builds.
        assert!(shortcut_benefit(120., 100., (40., 0.1), 12., 10.).is_some());
        assert!(shortcut_benefit(190., 100., usual, 12., 10.).is_some());
        assert_eq!(shortcut_benefit(190., 100., (40., 0.9), 12., 10.), None);
    }

    fn market() -> Town {
        Town::new(
            Seat {
                key: atlas_map::Id::from_name("market"),
                name: "Market".into(),
                centre: [0., 0.],
                story: Story {
                    people: 1600.,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        )
    }
    fn frontage<'a>(
        walking: &'a Ground,
        ground: &'a mut Ground,
        spatial: &'a dyn crate::spatial::SpatialKernel,
    ) -> Frontage<'a> {
        Frontage {
            walking_ground: walking,
            channel_depth: &|_| Ok(None),
            outlying: &[],
            links: &[],
            sources: &[],
            ground,
            spatial,
            candidates: &[],
            conditions: &[],
            exposure: 1.,
        }
    }
    #[test]
    fn a_shortcut_has_to_reach_the_far_street_before_the_town_pays_for_it() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = market();
        let from = [0., 0.];
        let to = [120., 0.];
        let size = town.seat.story.size();
        town.set_approaches(vec![
            Street::new(vec![from, [0., 25.]], Class::Lane, size),
            Street::new(vec![to, [120., 25.]], Class::Lane, size),
        ]);
        town.access_effort = 1000.;
        let project = Project {
            demand: "shortcut",
            joins_junctions: true,
            points: vec![from, to],
            benefit: 8.,
            class: Class::Lane,
        };
        let trace = StreetTrace {
            name: "Market",
            round: 1,
            enabled: false,
        };
        let clear = Ground::new([-30., -30., 155., 125.], 1.);
        let mut blocked = clear.clone();
        for i in blocked.cells_within([64., -25., 70., 30.]) {
            blocked.withhold(i, crate::town::ground::STEEP);
        }
        assert!(matches!(
            invest(
                &mut town,
                &mut frontage(&clear, &mut blocked, &spatial),
                &project,
                &trace
            )
            .unwrap(),
            Decision::Terrain
        ));
        assert_eq!(town.streets().len(), 2);
        assert_eq!(town.access_effort, 1000.);
        assert!(matches!(
            invest(
                &mut town,
                &mut frontage(&clear, &mut clear.clone(), &spatial),
                &project,
                &trace
            )
            .unwrap(),
            Decision::Built
        ));
        assert_eq!(town.streets().last().unwrap().points.last(), Some(&to));
    }

    #[test]
    fn building_one_crossing_removes_the_detour_behind_a_parallel_shortcut() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = market();
        let size = town.seat.story.size();
        let origin = [0., 0.];
        let first = [400., 0.];
        let second = [400., 75.];
        let roads = [
            vec![origin, [0., 250.]],
            vec![[0., 250.], [400., 250.]],
            vec![[400., 250.], second, first],
        ]
        .map(|points| Street::new(points, Class::Lane, size));
        town.set_approaches(roads.to_vec());
        town.access_effort = 1000.;
        let graph = Access::new(&roads, &spatial)
            .unwrap()
            .bind(
                &[origin, first, second].map(Entrance::external),
                AccessUse::Foot,
                &spatial,
            )
            .unwrap();
        let crossing = |to| Project {
            points: vec![origin, to],
            demand: "shortcut",
            joins_junctions: true,
            class: Class::Lane,
            benefit: 8.,
        };
        assert!(!shortcut_served(&town, &graph, &crossing(second)));
        let proposals = [first, second]
            .into_iter()
            .map(|to| (8., Investment::Route(crossing(to))))
            .collect();
        let land = Ground::new([-30., -30., 440., 290.], 2.);
        let trace = StreetTrace {
            name: "Market",
            round: 1,
            enabled: false,
        };
        let decisions = undertake(
            &mut town,
            &mut frontage(&land, &mut land.clone(), &spatial),
            &trace,
            proposals,
            Some(graph),
            None,
        )
        .unwrap();
        assert_eq!(decisions.work.built, 1);
        assert_eq!(town.streets().last().unwrap().points.last(), Some(&first));
        assert_eq!(decisions.work.spacing, 1);
    }

    fn occupy_both_streets(
        town: &mut Town,
        ground: &mut Ground,
        spatial: &dyn crate::spatial::SpatialKernel,
    ) {
        use crate::town::{
            catalogue::development::{household, HousingSite},
            fabric::Proposal,
            plots::{slots, Side},
        };
        let size = town.seat.story.size();
        town.set_approaches(
            [0., 40.]
                .map(|y| Street::new(vec![[-35., y], [35., y]], Class::Lane, size))
                .to_vec(),
        );
        let house = household(
            &HousingSite {
                scale: town.scale(),
                conditions: Default::default(),
                distance_from_seat: 20.,
                trade_demand: 0.,
                means: 0.5,
                form_sample: 0.1,
                livelihood_sample: 0.5,
            },
            &[],
        );
        for (i, side) in [Side::Right, Side::Left].into_iter().enumerate() {
            let street = &town.streets()[i];
            ground.take_street(street, FIRST_STREET + i as u32);
            let slot = slots(i, street, 10., 12., town.scale())
                .into_iter()
                .filter(|s| s.side == side)
                .min_by(|a, b| a.front[0].abs().total_cmp(&b.front[0].abs()))
                .unwrap();
            let roof = slot.occupied_shape();
            let proposal = Proposal {
                slot,
                kind: house,
                means: 0.5,
                priority: 1.,
                cause: "Street household".into(),
            };
            let id = town.establish(proposal, spatial).unwrap().unwrap();
            assert!(town.fit_building(id, roof, spatial).unwrap());
            town.occupy(id, 1., 0.5, 1., 0.);
        }
    }

    #[test]
    fn occupied_streets_build_one_shared_walking_connection() {
        use crate::processes::town::walks::{passages, Worn};
        use crate::town::fabric::walks::path_key;
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = market();
        let walking = Ground::new([-60., -30., 60., 75.], 1.);
        let mut ground = walking.clone();
        occupy_both_streets(&mut town, &mut ground, &spatial);
        let mut worn = Worn::new();
        for x in [-5., 5.] {
            for (a, b) in [(0., 20.), (20., 40.)] {
                worn.insert(path_key([x, a], [x, b]), (8., Class::Lane));
            }
        }
        let mut paths = Vec::new();
        let groups = passages::propose(&town, &worn, &spatial, &mut paths).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.iter().all(|p| p.joins.is_some()));
        let investments = paths
            .into_iter()
            .map(|p| (p.wear, Investment::Surface(p)))
            .collect();
        let trace = StreetTrace {
            name: "Market",
            round: 1,
            enabled: false,
        };
        town.access_effort = 1000.;
        let decisions = undertake(
            &mut town,
            &mut frontage(&walking, &mut ground, &spatial),
            &trace,
            investments,
            None,
            groups,
        )
        .unwrap();
        assert_eq!(decisions.surfaces.built, 1);
        assert_eq!(decisions.surfaces.spacing, 1);
        assert_eq!(town.streets().len(), 3);
        assert_eq!(
            town.noded_streets(&spatial)
                .unwrap()
                .street_groups(3)
                .size(0),
            3
        );
    }

    #[test]
    fn public_walks_open_frontage_up_to_an_obstruction_and_in_a_separate_neighbourhood() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = market();
        town.set_approaches(vec![Street::new(
            vec![[0., -20.], [0., 20.]],
            Class::Main,
            town.seat.story.size(),
        )]);
        town.access_effort = 1000.;
        let mut ground = Ground::new([-30., -30., 155., 125.], 1.);
        for i in 0..ground.count() {
            if ground.centre(i)[0] > 109. {
                ground.withhold(i, WATER);
            }
        }
        let walking = ground.clone();
        let mut context = frontage(&walking, &mut ground, &spatial);
        let course = |points| LaneCourse {
            joins: None,
            points,
            junctions: vec![],
            wear: 8.,
            class: Class::Lane,
        };
        let interrupted = course(vec![[112., 0.], [0., 0.]]);
        assert_built(&mut town, &mut context, &interrupted);
        let road = town.streets().last().unwrap();
        assert_eq!(road.points[0], [0., 0.]);
        assert!((90. ..109.).contains(&road.length()));
        let block = course(vec![[5., 90.], [100., 90.]]);
        assert_built(&mut town, &mut context, &block);
        let doorway = course(vec![[5., 110.], [12., 110.]]);
        assert!(matches!(
            surface(&mut town, &mut context, &doorway).unwrap(),
            Decision::Spacing
        ));
    }
}
