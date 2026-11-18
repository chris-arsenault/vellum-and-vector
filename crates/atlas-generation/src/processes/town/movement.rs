//! Access investments follow occupied land, unmet destinations and useful network connections.
use super::Frontage;
use crate::town::{
    access::{Access, Entrance, StreetLoad, Stretch},
    catalogue::{AccessUse, Activity, PlaceRules},
    edits::line,
    fabric::{EditOutcome, FabricEdit, FabricOwner, Relationship, Specification, Town},
    geometry::{add, distance, dot, left, scale, sub, unit, Point},
    ground::{FIRST_STREET, PLOT},
    network::Class,
    story::Layout,
};
use atlas_map::{Geometry, Position};
use std::io;

struct Project {
    demand: &'static str,
    points: Vec<Point>,
    benefit: f64,
    class: Class,
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

pub fn advance(town: &mut Town, context: &mut Frontage<'_>) -> io::Result<()> {
    town.access_effort += town.seat.story.people.max(5.).sqrt() * context.exposure * 2.5;
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
    let (widening, mut projects) = traffic(town, context)?;
    projects.extend(backland(town));
    projects.extend(prospects(town, context));
    projects.extend(occupied_ends(town, context));
    projects.extend(destinations(town, context)?);
    projects.extend(purpose_routes(town, context)?);
    projects.extend(shortcuts(town, context)?);
    trace.event(|| {
        serde_json::json!({
            "stage": "proposed",
            "routes": projects.len(),
            "widenings": widening.len(),
            "outlying": context.outlying.len()
        })
    });
    enum Investment {
        Route(Project),
        Widen(StreetLoad),
        Settle(usize),
    }
    let mut investments: Vec<_> = projects
        .into_iter()
        .map(|p| (p.benefit, Investment::Route(p)))
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
    let mut deferred = Vec::new();
    for (_, investment) in investments {
        if town.access_effort < 10. && !matches!(investment, Investment::Settle(_)) {
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
                invest(town, context, &project, &trace)?;
                deferred.push(project);
            }
            Investment::Widen(load) => {
                town.widen(load, context.ground, context.spatial)?;
            }
        }
    }
    if network_length(town) == initial_length && town.access_effort > 0. {
        seek_byway(town, context, &deferred, &trace)?;
    }
    Ok(())
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
    let (frontage, depth) = atlas_map::town::plot_size(size);
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
            class.width(size),
            reach,
            frontage,
        ) else {
            continue;
        };
        let street = crate::town::network::Street::new(path, class, size);
        let end = street.points.last().copied();
        let length = street.length();
        if matches!(
            build(town, context, street, project.benefit)?,
            RoadInvestment::Built(_)
        ) {
            trace.event(|| serde_json::json!({"stage":"byway","result":"built","demand":project.demand,"destination":to,"end":end,"length":length,"width":class.width(size)}));
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
    let depth = atlas_map::town::plot_size(size).1;
    for (arm, street_id) in town.growing_ways().to_vec() {
        let street = &town.streets()[street_id];
        let length = street.length();
        let end = *street.points.last().unwrap();
        let inhabited = town.holdings().iter().any(|h| {
            h.slot.street == Some(street_id) && h.slot.along + 2. * h.slot.depth >= length
        });
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
        if reach < crate::town::network::VERTEX_STEP {
            trace.event(|| serde_json::json!({"stage":"approach","id":street_id,"result":"insufficient reach","reach":reach}));
            continue;
        }
        if let Some(mut extension) = main_street(&goal, reach, size, context.ground) {
            let cost = extension.length() * 0.5;
            extension.class = street.class;
            extension
                .widths
                .fill(if inhabited && street.class == Class::Main {
                    Class::Main.width(size)
                } else {
                    Class::Road.width(size)
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
fn occupied_ends(town: &Town, context: &Frontage<'_>) -> Vec<Project> {
    use crate::town::{
        geometry::{angle, heading, rectangle},
        ground::{Rectangle, FREE},
        network::{lane, stops_lane},
    };
    let size = town.seat.story.size();
    let (frontage, depth) = atlas_map::town::plot_size(size);
    let mut projects = Vec::new();
    for (id, road) in town.streets().iter().enumerate() {
        let Some(pair) = road.points.last_chunk::<2>() else {
            continue;
        };
        if road.through_route
            || !town
                .holdings()
                .iter()
                .any(|h| h.slot.street == Some(id) && distance(h.slot.front, pair[1]) < depth * 2.)
        {
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
                    Class::Lane,
                    size,
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
                    class: Class::Lane,
                    points: vec![pair[1], tip],
                    benefit: land as f64 / (1. + turn.abs()),
                })
            })
            .max_by(|a, b| a.benefit.total_cmp(&b.benefit));
        projects.extend(best);
    }
    projects
}
fn prospects(town: &Town, context: &Frontage<'_>) -> Vec<Project> {
    let housed = town
        .holdings()
        .iter()
        .filter(|h| h.kind.definition().roles.dwelling)
        .count() as f64;
    let pressure = town.seat.story.people / (town.seat.story.people + housed * 5. + 1.);
    context
        .candidates
        .iter()
        .filter(|c| {
            c.slot.street.is_some_and(|street| {
                context.ground.open(
                    &crate::town::ground::Rectangle(&c.slot.corners),
                    FIRST_STREET + street as u32,
                )
            })
        })
        .map(|c| {
            let start = c.slot.front;
            let axis = town
                .seat
                .arms
                .first()
                .and_then(|arm| arm.points.windows(2).next())
                .map_or([1., 0.], |leg| unit(sub(leg[1], leg[0])));
            let (direction, priority) = street_bearing(
                town.layout,
                axis,
                sub(start, town.seat.centre),
                c.slot.inward,
                c.slot.depth,
            );
            let end = add(start, scale(direction, c.slot.depth * 2.5));
            let focal = 1. / (1. + distance(start, town.seat.centre) / 140.);
            let demand = c.opportunities.for_activity(Activity::Household).demand;
            Project {
                demand: "prospective frontage",
                class: Class::Lane,
                points: vec![start, end],
                benefit: priority * (pressure * 3. * focal + demand / (1. + demand)),
            }
        })
        .collect()
}
/// Choose the bearing for new frontage. Connections to an existing destination retain its position.
fn street_bearing(
    layout: Layout,
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
        Layout::Organic => (outward, 1.),
    }
}
fn traffic(town: &mut Town, context: &Frontage<'_>) -> io::Result<(Vec<StreetLoad>, Vec<Project>)> {
    let mut access =
        Access::new(town.streets(), context.spatial)?.on_ground(context.walking_ground);
    for &(a, b, cost) in context.links {
        access.add_link(a, b, cost, context.spatial)?;
    }
    let mut unmet = Vec::new();
    // hpc-exempt: named street stretches retain the loads of routed journeys.
    let mut use_ = std::collections::BTreeMap::<Stretch, f64>::new();
    for mode in [AccessUse::Foot, AccessUse::Freight, AccessUse::Waterborne] {
        let mut locations = Vec::new();
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
            let Some(source) = context.sources.iter().find(|s| {
                s.endpoint == tie.destination
                    && tie.purpose.offered_by(s.activity)
                    && s.demand + s.capability > 0.
            }) else {
                continue;
            };
            let origin = *destinations.entry(&source.endpoint).or_insert_with(|| {
                let i = locations.len();
                locations.push(Entrance::source(town, &source.endpoint, source.position));
                i
            });
            let target = locations.len();
            locations.push(Entrance::holding(town, h));
            travellers.entry(origin).or_default().push((
                target,
                h.occupation * share * (1. + h.kind.definition().demand),
                h.slot.front,
                source.position,
            ));
        }
        if locations.is_empty() {
            continue;
        }
        let graph = access.bind(&locations, mode, context.spatial)?;
        for (origin, trips) in travellers {
            let routes = graph.routes(origin);
            for (target, load, from, to) in trips {
                if routes.cost(target).is_finite() {
                    routes.visit(target, |s| *use_.entry(s).or_default() += load);
                } else if let Some(class) = mode.street_class() {
                    unmet.push(Project {
                        demand: "unrouted journey",
                        class,
                        points: vec![from, to],
                        benefit: load,
                    });
                }
            }
        }
    }
    let loads = street_loads(town, context, &use_)?;
    town.register_traffic(loads.clone(), context.exposure);
    Ok((loads, unmet))
}
// hpc-exempt: group journeys by a bound destination entrance to share its shortest paths.
type TripOrigins = std::collections::BTreeMap<usize, Vec<(usize, f64, Point, Point)>>;
// hpc-exempt: measure routed use by named street stretch.
type Loads = std::collections::BTreeMap<Stretch, f64>;
fn street_loads(town: &Town, context: &Frontage<'_>, use_: &Loads) -> io::Result<Vec<StreetLoad>> {
    let mut loads = Vec::new();
    for (street, road) in town.streets().iter().enumerate() {
        let stretches: Vec<_> = use_.iter().filter(|(s, _)| s.street == street).collect();
        if stretches.is_empty() {
            continue;
        }
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
        for ((_, value), m) in stretches.into_iter().zip(measures.as_chunks::<2>().0) {
            loads.push(StreetLoad {
                street,
                start: m[0].min(m[1]) * length,
                end: m[0].max(m[1]) * length,
                value: *value,
            });
        }
    }
    Ok(loads)
}
fn backland(town: &Town) -> Vec<Project> {
    town.holdings()
        .iter()
        .filter(|h| h.slot.street.is_some() && (h.occupation > 0.2 || h.public))
        .map(|h| {
            let flank = scale(h.slot.direction, h.slot.frontage / 2. + 5.);
            let start = add(add(h.slot.front, flank), scale(h.slot.inward, -5.));
            let rear = add(
                add(h.slot.front, flank),
                scale(h.slot.inward, h.slot.depth + 20.),
            );
            let lateral = match town.layout {
                Layout::Radial => 0.,
                Layout::Linear => h.slot.depth * 1.5,
                _ => h.slot.frontage * 2.,
            };
            let end = add(rear, scale(h.slot.direction, lateral));
            Project {
                demand: "occupied backland",
                class: Class::Lane,
                points: vec![start, rear, end],
                benefit: (0.3 + h.occupation + h.crowding + h.kind.definition().prominence)
                    / (1. + h.slot.depth / 100.)
                    * (0.3 + 1. / (1. + distance(h.slot.front, town.seat.centre) / 140.)),
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
            class: Class::Lane,
            points: vec![[x, y], source.position],
            benefit: source.demand / (1. + source.demand)
                + source.capability / (1. + source.capability),
        });
    }
    Ok(result)
}
fn shortcuts(town: &Town, context: &Frontage<'_>) -> io::Result<Vec<Project>> {
    let ends: Vec<_> = town
        .streets()
        .iter()
        .flat_map(|s| [s.points[0], *s.points.last().unwrap()])
        .collect();
    if ends.len() < 3 {
        return Ok(vec![]);
    }
    let edges = context
        .spatial
        .delaunay_edges(
            &ends
                .iter()
                .map(|p| Position::xy(p[0], p[1]))
                .collect::<Vec<_>>(),
        )
        .map_err(io::Error::other)?;
    let mut access =
        Access::new(town.streets(), context.spatial)?.on_ground(context.walking_ground);
    for &(a, b, cost) in context.links {
        access.add_link(a, b, cost, context.spatial)?;
    }
    let entrances: Vec<_> = ends.iter().copied().map(Entrance::external).collect();
    let network = access.bind(&entrances, AccessUse::Foot, context.spatial)?;
    let mut neighbours = vec![Vec::new(); ends.len()];
    for [a, b] in edges {
        neighbours[a].push(b);
    }
    let mut result = Vec::new();
    for (a, adjacent) in neighbours.iter().enumerate().filter(|(_, v)| !v.is_empty()) {
        let routes = network.routes(a);
        for &b in adjacent {
            let direct = distance(ends[a], ends[b]);
            if direct < 25. {
                continue;
            }
            let cost = routes.cost(b);
            let gain = (cost - direct) / (direct + 40.);
            if gain > 0.4 {
                result.push(Project {
                    demand: "shortcut",
                    class: Class::Lane,
                    points: vec![ends[a], ends[b]],
                    benefit: gain * (1. + town.holdings().len() as f64 / 100.),
                });
            }
        }
    }
    Ok(result)
}
fn invest(
    town: &mut Town,
    context: &mut Frontage<'_>,
    project: &Project,
    trace: &StreetTrace<'_>,
) -> io::Result<()> {
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
    let mut points = project.points.clone();
    if !town.streets().is_empty() {
        let roads: Vec<_> = town.streets().iter().map(|s| line(&s.points)).collect();
        let index = context.spatial.index(&roads).map_err(io::Error::other)?;
        let p = Position::xy(points[0][0], points[0][1]);
        let Some(i) = index.nearest(p).map_err(io::Error::other)? else {
            return Ok(());
        };
        let [start, _] = context
            .spatial
            .nearest_points(&roads[i], &Geometry::Point { coordinates: p })
            .map_err(io::Error::other)?;
        let [x, y, _] = start.coordinates();
        points[0] = [x, y];
    }
    if points.len() == 2 && !town.streets().is_empty() {
        let network = crate::town::lanes::Network {
            streets: town.streets().to_vec(),
        };
        let Some((end, _)) = crate::town::growth::constrain(
            &[points[0], points[1]],
            &network,
            60.,
            context.spatial,
        )?
        else {
            decision("network spacing or overlap", None, town.access_effort);
            return Ok(());
        };
        points[1] = end;
    }
    let Some(street) = crate::town::network::lane(
        &points,
        project.class,
        town.seat.story.size(),
        context.ground,
        crate::town::network::stops_lane,
        20.,
    ) else {
        decision("less than 20m usable corridor", None, town.access_effort);
        return Ok(());
    };
    let effort = town.access_effort;
    let (label, cost) = match build(town, context, street, project.benefit)? {
        RoadInvestment::Built(cost) => ("built", cost),
        RoadInvestment::TooExpensive(cost) => ("insufficient effort", cost),
        RoadInvestment::Declined(cost) => ("land claim declined", cost),
    };
    decision(label, Some(cost), effort);
    Ok(())
}
enum RoadInvestment {
    Built(f64),
    TooExpensive(f64),
    Declined(f64),
}
fn build(
    town: &mut Town,
    context: &mut Frontage<'_>,
    street: crate::town::network::Street,
    benefit: f64,
) -> io::Result<RoadInvestment> {
    let cost = street.length() * 0.5;
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
