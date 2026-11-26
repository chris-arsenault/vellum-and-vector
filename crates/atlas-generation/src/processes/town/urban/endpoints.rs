//! Decide which gateways, centres and wards have journeys between them.
use super::geometry::pos;
use crate::{
    field::refinement::courses::cell_at,
    spatial::SpatialKernel,
    town::city::hot_spots,
    town::geometry::{distance, Point},
};
use std::io;

fn preferred_centre(
    origin: usize,
    hubs: &[(usize, f64)],
    catchment: f64,
    span: impl Fn(usize, usize) -> f64,
) -> Option<usize> {
    let own = hubs.iter().find(|(i, _)| *i == origin);
    let pull = |i, weight: f64| weight / (1. + span(origin, i) / catchment).powi(2);
    hubs.iter()
        .filter(|(i, draw)| *i != origin && own.is_none_or(|(j, w)| draw > w || draw == w && i < j))
        .max_by(|(b, x), (c, y)| pull(*b, *x).total_cmp(&pull(*c, *y)))
        .map(|(b, _)| *b)
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Journey {
    BetweenCentres,
    FromGateway,
    FromWard,
    CrossLink,
}

pub(super) struct Connection {
    pub purpose: Journey,
    pub endpoints: [usize; 2],
    pub demand: f64,
}

pub(super) struct RoadPlan {
    pub stops: Vec<(usize, String)>,
    pub connections: Vec<Connection>,
}

pub(super) struct Sites {
    pub gateways: Vec<(usize, String)>,
    pub destinations: Vec<(usize, String)>,
    pub spacing: f64,
}

/// Candidate stops come from the city as a whole. Park entrances are on their usable edge,
/// and the same surveyed park coverage constrains the later route search.
pub(super) fn candidate_sites(
    state: &crate::atlas::state::State,
    u: &mut super::Urban,
    frame: &atlas_map::Geometry,
    points: &[Point],
    gateways: Vec<(usize, String)>,
) -> io::Result<(Sites, Vec<bool>)> {
    let mesh = state.field().mesh();
    let n = mesh.len();
    let policy = super::fields::policy(state)?;
    let claims = &u.fields.claims;
    let score: Vec<_> = claims
        .iter()
        .enumerate()
        .map(|(i, x)| {
            if !u.fields.inside[i] || x.reserved || x.people < 180. {
                0.
            } else {
                (x.home + x.work + 0.6 * u.fields.developed[i] - 0.3 * x.farm).max(0.)
                    * (u.fields.stencil[i]
                        + if x.built > 0.12 || x.trade > 0.45 {
                            0.35
                        } else {
                            0.
                        })
            }
        })
        .collect();
    let census = crate::atlas::regional::city::settlement(state)?
        .and_then(|s| s.people)
        .unwrap_or(0.);
    let spacing = (state.spatial.area(frame).map_err(io::Error::other)?
        / (1. + (census / 3200.).sqrt() * 3.))
        .sqrt()
        .max(3. * mesh.spacing());
    u.destinations = hot_spots(&score, points, spacing, usize::MAX);
    let mut stops: Vec<(usize, String)> = u
        .sponsors
        .iter()
        .map(|s| (s.cell, s.name.clone()))
        .collect();
    stops.extend(u.programs.iter().map(|p| (p.cell, p.name.clone())));
    stops.extend(u.interior.iter().map(|(c, p)| (*c, p.name.clone())));
    let positions: Vec<_> = points.iter().copied().map(pos).collect();
    let mut green = vec![false; n];
    for park in &u.parks {
        let covered = state
            .spatial
            .covers_points(&park.geometry, &positions)
            .map_err(io::Error::other)?;
        let entrance = (0..n)
            .filter(|&c| {
                !covered[c]
                    && !claims[c].reserved
                    && (0..3).any(|edge| mesh.neighbor(c, edge).is_some_and(|b| covered[b]))
            })
            .max_by(|&a, &b| {
                let access = |c: usize| u.fields.access[c] + claims[c].home + claims[c].work;
                access(a).total_cmp(&access(b))
            });
        if let Some(c) = entrance {
            stops.push((c, park.name.clone()));
        }
        for (held, on) in green.iter_mut().zip(covered) {
            *held |= on;
        }
    }
    if let Some((a, b, name)) = policy.connector() {
        for role in [a, b] {
            if let Some(c) = policy.site.point(role).and_then(|p| cell_at(mesh, p)) {
                stops.push((c, name.into()));
            }
        }
    }
    for founder in policy.kernel() {
        if let Some(c) = policy
            .site
            .point(founder.anchor)
            .and_then(|p| cell_at(mesh, p))
        {
            stops.push((c, "Founding quarter".into()));
        }
    }
    stops.extend(
        u.destinations
            .iter()
            .map(|&c| (c, "District approach".into())),
    );
    Ok((
        Sites {
            gateways,
            destinations: stops,
            spacing,
        },
        green,
    ))
}

pub(super) fn select_endpoints(
    state: &crate::atlas::state::State,
    u: &super::Urban,
    points: &[Point],
    sites: Sites,
    buildable: impl Fn(usize) -> bool,
    network: &[bool],
    founding: bool,
) -> io::Result<RoadPlan> {
    let Sites {
        gateways,
        destinations: stops,
        spacing,
    } = sites;
    let mesh = state.field().mesh();
    let claims = &u.fields.claims;
    let entry_cells: Vec<_> = gateways.iter().map(|(cell, _)| *cell).collect();
    let mut hubs = gateways;
    hubs.extend(
        u.sponsors
            .iter()
            .filter(|p| p.work.is_some())
            .map(|p| (p.cell, p.name.clone())),
    );
    if hubs.len() < 2 || !founding {
        hubs.extend(u.programs.iter().map(|p| (p.cell, p.name.clone())));
    }
    // A market or civic centre draws trips from more than its own ward. Compete
    // against nearby centres using both the programme and its occupied hinterland.
    let activity: Vec<_> = claims
        .iter()
        .map(|x| x.trade.max(0.).ln_1p() + x.work + x.people.max(0.).ln_1p() * x.built)
        .collect();
    let mut centres = Vec::new();
    for p in &u.programs {
        if !buildable(p.cell) {
            continue;
        }
        let [backing] = super::fields::neighborhood(mesh, [&activity], p.cell, p.reach);
        let draw = (1. + backing)
            * (p.demands.trade.max(0.) + p.demands.civic.max(0.) + p.demands.access.max(0.));
        if draw > 0. {
            centres.push((p, draw));
        }
    }
    let city_span = state
        .spatial
        .area(state.scope.settled_outline())
        .map_err(io::Error::other)?
        .sqrt();
    let reach = city_span * 0.42;
    let centres: Vec<_> = centres
        .iter()
        .filter(|(p, draw)| {
            !centres.iter().any(|(other, stronger)| {
                mesh.physical_distance(p.cell, other.cell) < reach
                    && (stronger > draw || stronger == draw && other.cell < p.cell)
            })
        })
        .map(|(p, draw)| (p.cell, p.name.clone(), *draw))
        .collect();
    hubs.extend(centres.iter().map(|(c, name, _)| (*c, name.clone())));
    let mut arrivals = hubs;
    if !founding {
        // A City landmark can share the approach of its neighbourhood.
        // Streets from individual doors belong to the district map.
        for stop in stops {
            if arrivals
                .iter()
                .all(|(c, _)| mesh.physical_distance(*c, stop.0) > spacing * 0.65)
            {
                arrivals.push(stop);
            }
        }
    }
    arrivals.retain(|(c, _)| buildable(*c) || network[*c]);
    let mut occupied = vec![false; mesh.len()];
    arrivals.retain(|(c, _)| !std::mem::replace(&mut occupied[*c], true));
    let attraction: Vec<_> = arrivals
        .iter()
        .map(|(c, _)| {
            let x = claims[*c];
            (1. + x.home + x.work + x.trade.max(0.).ln_1p() + u.fields.civic[*c]).max(1.)
        })
        .collect();
    pair_destinations(
        state.spatial.as_ref(),
        points,
        arrivals,
        &entry_cells,
        &centres,
        &attraction,
        city_span * 0.22,
    )
}

fn pair_destinations(
    spatial: &dyn SpatialKernel,
    points: &[Point],
    stops: Vec<(usize, String)>,
    entrances: &[usize],
    centres: &[(usize, String, f64)],
    attraction: &[f64],
    catchment: f64,
) -> io::Result<RoadPlan> {
    if stops.len() < 2 {
        return Ok(RoadPlan {
            stops,
            connections: vec![],
        });
    }
    let at: Vec<_> = stops.iter().map(|(c, _)| pos(points[*c])).collect();
    let mut edges = if stops.len() == 2 {
        vec![[0, 1]]
    } else {
        spatial.delaunay_edges(&at).map_err(io::Error::other)?
    };
    if edges.is_empty() {
        // Collinear settlements share a single valley or ridge route.
        let mut order: Vec<_> = (0..stops.len()).collect();
        // hpc-exempt: sparse destination identities ordered along a collinear route.
        order.sort_by(|&a, &b| {
            points[stops[a].0]
                .partial_cmp(&points[stops[b].0])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        edges.extend(order.windows(2).map(|p| [p[0], p[1]]));
    }
    let span = |a: usize, b: usize| distance(points[stops[a].0], points[stops[b].0]);
    let priority = |a: usize, b: usize| span(a, b) / (attraction[a] * attraction[b]).sqrt();
    // hpc-exempt: rank the sparse Delaunay links between actual destinations.
    edges.sort_by(|[a, b], [c, d]| priority(*a, *b).total_cmp(&priority(*c, *d)));
    // owner-direction(2026-11-24): the major roads alone should reveal where journeys gather, cross the city and continue.
    let hubs: Vec<_> = centres
        .iter()
        .filter_map(|(c, _, draw)| stops.iter().position(|s| s.0 == *c).map(|i| (i, *draw)))
        .collect();
    let mean_pull = attraction.iter().sum::<f64>() / stops.len() as f64;
    let mut journeys = Vec::new();
    // Inter-centre journeys establish the common corridors first. Each gateway and
    // ward then sends trips to its strongest accessible centre. Local cross-links
    // still compete on the detour between neighbouring destinations.
    for (a, &(cell, _)) in stops.iter().enumerate() {
        let gateway = entrances.contains(&cell);
        let target = if hubs.is_empty() && gateway {
            (0..stops.len())
                .filter(|&b| a != b)
                .max_by(|&b, &c| attraction[b].total_cmp(&attraction[c]))
        } else {
            preferred_centre(a, &hubs, catchment, span)
        };
        if let Some(b) = target {
            let kind = if hubs.iter().any(|(i, _)| *i == a) {
                Journey::BetweenCentres
            } else if gateway {
                Journey::FromGateway
            } else {
                Journey::FromWard
            };
            let weight = (attraction[a] / mean_pull).sqrt()
                * if kind == Journey::FromWard { 1. } else { 3. };
            journeys.push(Connection {
                purpose: kind,
                endpoints: [a, b],
                demand: weight,
            });
        }
    }
    // hpc-exempt: order the sparse set of named journeys by their role in city development.
    journeys.sort_by_key(|journey| journey.purpose);
    journeys.extend(edges.into_iter().map(|endpoints| Connection {
        purpose: Journey::CrossLink,
        endpoints,
        demand: 0.5,
    }));
    Ok(RoadPlan {
        stops,
        connections: journeys,
    })
}

#[cfg(test)]
mod tests {
    use super::preferred_centre;

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn gateway_and_ward_choose_a_market_before_any_road_is_routed() {
        use super::{pair_destinations, Journey};
        let spatial = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let points = [[1., 2.], [1., 1.], [3., 2.], [4., 1.]];
        let stops = vec![
            (3, "East gate".into()),
            (0, "Ward".into()),
            (2, "Market".into()),
        ];
        let plan = pair_destinations(
            &spatial,
            &points,
            stops,
            &[3],
            &[(2, "Market".into(), 5.)],
            &[2., 1., 5.],
            4.,
        )
        .unwrap();
        for (purpose, start) in [(Journey::FromGateway, 3), (Journey::FromWard, 0)] {
            assert!(plan.connections.iter().any(|c| c.purpose == purpose
                && c.endpoints.map(|index| plan.stops[index].0) == [start, 2]
                && c.demand > 0.));
        }
    }

    #[test]
    fn city_journeys_converge_and_secondary_centres_still_serve_their_hinterland() {
        let stations: [f64; 5] = [0., 1., 4., 10., 11.];
        let span = |a: usize, b: usize| (stations[a] - stations[b]).abs();
        let centres = [(1, 4.), (3, 7.)];
        assert_eq!(preferred_centre(0, &centres, 4., span), Some(1));
        assert_eq!(preferred_centre(2, &centres, 4., span), Some(1));
        assert_eq!(preferred_centre(4, &centres, 4., span), Some(3));
        assert_eq!(preferred_centre(1, &centres, 4., span), Some(3));
        assert_eq!(preferred_centre(3, &centres, 4., span), None);
    }
}
