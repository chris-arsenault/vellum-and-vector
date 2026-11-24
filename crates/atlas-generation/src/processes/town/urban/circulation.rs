//! Connect actual urban destinations to the inherited network across traversable ground.
use super::{
    fields::{policy, position},
    geometry::pos,
    within_frame, Element, Urban,
};
use crate::{
    atlas::state::State,
    features::Feature,
    field::{
        people::work::{habitable, working},
        refinement::courses::{cell_at, course_cells},
        shared::Scalar,
    },
    metric::search::search,
    town::city::hot_spots,
};
use atlas_map::{
    regions::{boundary_lines, point},
    Geometry,
};
use std::io;

pub(super) fn routes(
    state: &mut State,
    u: &mut Urban,
    frame: &Geometry,
    approaches: Vec<Feature>,
) -> io::Result<()> {
    super::places::destinations(state, u)?;
    let f = state.field();
    let mesh = f.mesh();
    let policy = policy(state)?;
    let n = mesh.len();
    let points: Vec<_> = (0..n).map(|c| position(mesh, c)).collect();
    u.routes.clear();
    let mut network = vec![false; n];
    for f in approaches {
        let Some(f) = within_frame(state.spatial.as_ref(), f, frame)? else {
            continue;
        };
        for trace in boundary_lines(&f.geometry) {
            let mut road = Element::way(
                Geometry::LineString { coordinates: trace },
                "thoroughfare",
                "Approach",
                16.,
            );
            for c in course_cells(mesh, &road.geometry, mesh.spacing(), 0.) {
                network[c] = true;
            }
            road.name = f.name.clone();
            road.attributes
                .insert("sourceRoad".into(), f.id.to_string().into());
            u.routes.push(road);
        }
    }
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
    u.destinations = hot_spots(&score, &points, spacing, usize::MAX);
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
    if !network.iter().any(|v| *v) {
        if let Some(c) =
            cell_at(mesh, policy.site.centre).or_else(|| u.destinations.first().copied())
        {
            network[c] = true;
        }
    }
    let slope = f.shared().scalar(Scalar::Slope);
    let mut effort = Vec::with_capacity(n);
    for c in 0..n {
        let x = claims[c];
        let demand =
            super::programs::at(u, c).map_or(0., |p| p.demands_at(position(mesh, c)).access);
        let access_cost = (-0.45 * demand * u.fields.stencil[c]).exp();
        effort.push(if !habitable(f, c)? || green[c] && !network[c] {
            f64::INFINITY
        } else {
            access_cost
                * (1.
                    + 4. * slope.get(c)?.max(0.)
                    + x.farm * 0.6
                    + f64::from(x.reserved as u8) * 4.)
                / (1. + 0.45 * x.work + 0.25 * u.fields.developed[c] + 0.3 * u.fields.civic[c])
        });
    }
    let city = &state.regional.as_ref().unwrap().city;
    let depth: Vec<_> = (0..n)
        .map(|c| {
            crate::town::walls::enclosure(&city.walls, c)
                + crate::town::walls::enclosure(&u.defense, c)
        })
        .collect();
    let mut wall = vec![false; n];
    let mut gate = vec![false; n];
    for &c in &city.gate_crossings {
        gate[c as usize] = true;
    }
    for shape in &u.inherited_defenses {
        match shape {
            Geometry::LineString { .. } | Geometry::MultiLineString { .. } => {
                for c in course_cells(mesh, shape, mesh.spacing(), 0.) {
                    wall[c] = true;
                }
            }
            Geometry::Point { coordinates } => {
                if let Some(c) = cell_at(mesh, super::geometry::xy(*coordinates)) {
                    gate[c] = true;
                }
            }
            _ => {}
        }
    }
    let crossing = |a: usize, b: usize| {
        if (depth[a] != depth[b] || wall[b]) && !gate[a] && !gate[b] {
            4.
        } else {
            1.
        }
    };
    let mut cost = working(f);
    let mut previous: Vec<usize> = (0..n).collect();
    let mut seeds = Vec::new();
    for (c, &on) in network.iter().enumerate() {
        cost.set(c, if on { 0. } else { f64::INFINITY })?;
        if on {
            seeds.push(c);
        }
    }
    search(
        mesh,
        seeds,
        &mut cost,
        f64::INFINITY,
        |next, from| {
            previous[next] = from;
            Ok(())
        },
        |a, b, e| {
            let alignment = policy.align(points[a]).map_or(1., |axis| {
                let dir =
                    crate::town::geometry::unit(crate::town::geometry::sub(points[b], points[a]));
                1. + 0.55 * (1. - crate::town::geometry::dot(dir, axis).abs().min(1.))
            });
            Ok(mesh.edge_length(a, e) * (effort[a] + effort[b]) * 0.5 * alignment * crossing(a, b))
        },
    )?;
    let mut corridors: Vec<_> = u.routes.iter().map(|e| e.geometry.clone()).collect();
    for (stop, destination) in stops {
        if !u.fields.inside[stop] || !cost.get(stop)?.is_finite() || network[stop] {
            continue;
        }
        let mut c = stop;
        let mut vertices = vec![pos(points[c])];
        while !network[c] && previous[c] != c {
            network[c] = true;
            c = previous[c];
            vertices.push(pos(points[c]));
        }
        if vertices.len() < 2 {
            continue;
        }
        if !corridors.is_empty() {
            let at = point(*vertices.last().unwrap());
            let index = state.spatial.index(&corridors).map_err(io::Error::other)?;
            if let Some(i) = index
                .nearest(*vertices.last().unwrap())
                .map_err(io::Error::other)?
            {
                let [_, end] = state
                    .spatial
                    .nearest_points(&at, &corridors[i])
                    .map_err(io::Error::other)?;
                if state
                    .spatial
                    .distance(&at, &point(end))
                    .map_err(io::Error::other)?
                    < mesh.spacing() * 2.
                {
                    *vertices.last_mut().unwrap() = end;
                }
            }
        }
        let line = Geometry::LineString {
            coordinates: vertices,
        };
        let line = state
            .spatial
            .resample_trace(&line, mesh.spacing() * 0.63, None)
            .map_err(io::Error::other)?;
        if let Some(inside) = state
            .spatial
            .clip_trace(&line, frame)
            .map_err(io::Error::other)?
        {
            let mut way = Element::way(inside.clone(), "thoroughfare", "Avenue", 14.);
            way.attributes
                .insert("destination".into(), destination.into());
            u.routes.push(way);
            corridors.push(inside);
        }
    }
    // Walk from the final corridors, so access measures the route network actually proposed.
    let mut seeds = Vec::new();
    network.fill(false);
    for way in &u.routes {
        for c in course_cells(mesh, &way.geometry, mesh.spacing(), 0.) {
            if !network[c] {
                network[c] = true;
                seeds.push(c);
            }
        }
    }
    for (c, on) in network.iter().enumerate() {
        cost.set(c, if *on { 0. } else { f64::INFINITY })?;
    }
    search(
        mesh,
        seeds,
        &mut cost,
        f64::INFINITY,
        |_, _| Ok(()),
        |a, b, e| Ok(mesh.edge_length(a, e) * (1. + slope.get(b)?.max(0.) * 4.) * crossing(a, b)),
    )?;
    u.fields.access = (0..n)
        .map(|c| Ok(1. / (1. + (cost.get(c)? / 400.).powi(2))))
        .collect::<io::Result<_>>()?;
    Ok(())
}

pub(super) fn crossings(state: &mut State, urban: &Urban) -> io::Result<()> {
    let mesh = state.field().mesh();
    let city = &state.regional.as_ref().unwrap().city;
    if city.walls.is_empty() {
        return Ok(());
    }
    let mut crossings = Vec::new();
    for route in &urban.routes {
        crossings.extend(
            course_cells(mesh, &route.geometry, mesh.spacing(), 0.)
                .into_iter()
                .map(|c| c as u32),
        );
    }
    crossings.sort_unstable();
    crossings.dedup();
    state.regional.as_mut().unwrap().city.gate_crossings = crossings;
    Ok(())
}
