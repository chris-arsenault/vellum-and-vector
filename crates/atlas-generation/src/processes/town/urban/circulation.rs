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
};
use atlas_map::{regions::boundary_lines, Geometry};
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
    let Approaches {
        founding,
        mut network,
        gateways,
    } = collect_approaches(state, u, frame, approaches, policy)?;
    let (sites, green) = super::endpoints::candidate_sites(state, u, frame, &points, gateways)?;
    let spacing = sites.spacing;
    let claims = &u.fields.claims;
    let slope = f.shared().scalar(Scalar::Slope);
    let elevations = f.ground().view(crate::rock::ground::GroundField::Elevation);
    let height_metres = |c| {
        Ok(crate::scale::MapScale::metres(
            elevations.get(c)?,
            crate::scale::LengthUnit::Native,
        ))
    };
    let gradients = (0..n)
        .map(|c| mesh.gradient(c, &height_metres))
        .collect::<io::Result<Vec<_>>>()?;
    let settled = claims
        .iter()
        .enumerate()
        .filter(|(c, x)| u.fields.stencil[*c] > 0.5 && x.people > 0.);
    let (total, area) = settled.fold((0., 0.), |(sum, area), (c, x)| {
        (sum + mesh.area(c) * x.people, area + mesh.area(c))
    });
    let usual_density = (total / area.max(1.)).max(1.);
    let seed = state
        .scope
        .city
        .as_ref()
        .map_or(0, |s| s.settlement.0 as i32);
    let terrain_reach = (mesh.spacing() * 4.).max(spacing * 0.55);
    let mut effort = Vec::with_capacity(n);
    for c in 0..n {
        let x = claims[c];
        let demand = x.demands.access;
        let access_cost = (-0.45
            * (demand * u.fields.stencil[c] + u.fields.civic[c] * u.work_at(c).access))
            .exp();
        let residents = x.people.max(0.);
        let populated = residents / (residents + usual_density);
        // The catalogue already expresses how hot ground, tears, wards and ordinary
        // works change passage. Use those local fields with their own direction and reach.
        let ground_cost = f.place_offers().map_or(Ok(1.), |p| p.road(c))?;
        let [px, py] = points[c];
        let texture = crate::chance::Chance::of(seed, 0x4129)
            .noise(terrain_reach, 2)
            .signed([px, py]);
        effort.push(
            if !u.fields.inside[c] || !habitable(f, c)? || green[c] && !network[c] {
                f64::INFINITY
            } else {
                access_cost * ground_cost * (0.75 * texture).exp() / (0.58 + 1.25 * populated)
                    * (1.
                        + 4. * slope.get(c)?.max(0.)
                        + x.farm * 0.6
                        + f64::from(x.reserved as u8) * 4.)
                    / (1. + 0.45 * x.work + 0.25 * u.fields.developed[c] + 0.3 * u.fields.civic[c])
            },
        );
    }
    let heights = (0..n).map(height_metres).collect::<io::Result<Vec<_>>>()?;
    let terrain = super::grades::terrain(mesh, &heights);
    let survey = super::grades::Survey {
        elevation: &terrain,
        open: &|p| cell_at(mesh, p).is_some_and(|c| effort[c].is_finite()),
    };
    if founding {
        network.fill(false);
        for approach in &mut u.routes {
            let mut graded = survey.road(approach.geometry.clone(), "Approach", 16.);
            graded.name = approach.name.clone();
            graded.attributes.insert(
                "sourceRoad".into(),
                approach.attributes["sourceRoad"].clone(),
            );
            for cell in super::grades::ground_cells(mesh, &graded) {
                network[cell] = true;
            }
            *approach = graded;
        }
    }
    let (wall, gate) = wall_crossings(u, mesh);
    let crossing = |a: usize, b: usize| {
        if wall[a] != wall[b] && !gate[a] && !gate[b] {
            4.
        } else {
            1.
        }
    };
    // owner-direction(2026-11-24): principal roads grow from whole-city journeys, then refine their alignment and district connections.
    // owner-direction(2026-11-25): select road endpoints separately from routing between them.
    let plan = super::endpoints::select_endpoints(
        state,
        u,
        sites,
        |cell| effort[cell].is_finite(),
        &network,
        founding,
    )?;
    let aligned: Vec<_> = points.iter().map(|&p| policy.align(p)).collect();
    let surface = super::journeys::Surface {
        mesh,
        points: &points,
        effort: &effort,
        aligned: &aligned,
        gradients: &gradients,
        seed,
        crossing: &crossing,
    };
    let traffic = super::journeys::route_connections(
        state,
        &surface,
        &survey,
        plan,
        &mut network,
        &mut u.routes,
    )?;
    update_road_access(u, f, network, crossing, &traffic)?;
    Ok(())
}

fn update_road_access(
    u: &mut Urban,
    f: &crate::field::Field,
    mut network: Vec<bool>,
    crossing: impl Fn(usize, usize) -> f64,
    traffic: &[f64],
) -> io::Result<()> {
    let mesh = f.mesh();
    let n = mesh.len();
    let slope = f.shared().scalar(Scalar::Slope);
    let mut cost = working(f);
    let mut seeds = Vec::new();
    network.fill(false);
    for way in &u.routes {
        for c in super::grades::ground_cells(mesh, way) {
            if !network[c] {
                network[c] = true;
                seeds.push(c);
            }
        }
    }
    for (c, on) in network.iter().enumerate() {
        cost.set(
            c,
            if *on {
                mesh.spacing() * 0.45 / (1. + traffic[c])
            } else {
                f64::INFINITY
            },
        )?;
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

fn wall_crossings(u: &Urban, mesh: &crate::lattice::TriangularLattice) -> (Vec<bool>, Vec<bool>) {
    let n = mesh.len();
    let mut wall = vec![false; n];
    let mut gate = vec![false; n];
    for defense in &u.defense {
        let geometry = Geometry::MultiLineString {
            coordinates: defense.lines.iter().map(|s| s.map(pos).to_vec()).collect(),
        };
        for c in course_cells(mesh, &geometry, mesh.spacing(), 0.) {
            wall[c] = true;
        }
        for &p in &defense.gates {
            if let Some(c) = cell_at(mesh, p) {
                gate[c] = true;
            }
        }
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
    (wall, gate)
}

fn approach_gateways(
    stencil: &[f64],
    cells: &[usize],
    f: &Feature,
    entrances: &mut Vec<(usize, String)>,
    inland_ends: &mut Vec<(usize, String)>,
) {
    let inside = |c: usize| stencil[c] > 0.5;
    for pair in cells.windows(2).filter(|p| inside(p[0]) != inside(p[1])) {
        entrances.push((
            if inside(pair[0]) { pair[0] } else { pair[1] },
            f.name.clone(),
        ));
    }
    // A route clipped into several pieces still has one identity. Only a real
    // passage across the urban edge supplies a gateway. For a route wholly
    // inside the city, keep its most peripheral station as the connecting site.
    if let Some(c) = cells
        .iter()
        .copied()
        .filter(|&c| inside(c))
        .min_by(|&a, &b| stencil[a].total_cmp(&stencil[b]))
    {
        if let Some((old, _)) = inland_ends.iter_mut().find(|(_, name)| name == &f.name) {
            if stencil[c] < stencil[*old] {
                *old = c;
            }
        } else {
            inland_ends.push((c, f.name.clone()));
        }
    }
}

struct Approaches {
    founding: bool,
    network: Vec<bool>,
    gateways: Vec<(usize, String)>,
}

fn collect_approaches(
    state: &State,
    u: &mut Urban,
    frame: &Geometry,
    approaches: Vec<Feature>,
    policy: &crate::town::templates::Selection,
) -> io::Result<Approaches> {
    let mesh = state.field().mesh();
    let n = mesh.len();
    let founding = u.routes.is_empty();
    let mut entrances = Vec::new();
    let mut inland_ends: Vec<(usize, String)> = Vec::new();
    let mut network = vec![false; n];
    for f in approaches {
        let Some(f) = within_frame(state.spatial.as_ref(), f, frame)? else {
            continue;
        };
        for trace in boundary_lines(&f.geometry) {
            let cells = course_cells(
                mesh,
                &Geometry::LineString {
                    coordinates: trace.clone(),
                },
                mesh.spacing(),
                0.,
            );
            approach_gateways(
                &u.fields.stencil,
                &cells,
                &f,
                &mut entrances,
                &mut inland_ends,
            );
            if !founding {
                continue;
            }
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
    let gateways = merge_gateways(mesh, policy.quarter(), entrances, inland_ends);
    for way in &u.routes {
        for c in super::grades::ground_cells(mesh, way) {
            network[c] = true;
        }
    }
    Ok(Approaches {
        founding,
        network,
        gateways,
    })
}

fn merge_gateways(
    mesh: &crate::lattice::TriangularLattice,
    quarter: f64,
    mut entrances: Vec<(usize, String)>,
    inland_ends: Vec<(usize, String)>,
) -> Vec<(usize, String)> {
    for (c, name) in inland_ends {
        if !entrances.iter().any(|(_, road)| road == &name) {
            entrances.push((c, name));
        }
    }
    let mut gateways: Vec<(usize, String)> = Vec::new();
    for (c, name) in entrances {
        if !gateways
            .iter()
            .any(|(g, _)| mesh.physical_distance(c, *g) < quarter)
        {
            gateways.push((c, name));
        }
    }
    gateways
}

pub(super) fn crossings(state: &mut State, urban: &Urban) -> io::Result<()> {
    let city = &mut state.regional.as_mut().unwrap().city;
    if city.walls.is_empty() || urban.routes.is_empty() {
        return Ok(());
    }
    let k = state.spatial.as_ref();
    let routes = Geometry::MultiLineString {
        coordinates: urban
            .routes
            .iter()
            .flat_map(|e| boundary_lines(&e.geometry))
            .collect(),
    };
    for wall in &mut city.walls {
        let built = Geometry::MultiLineString {
            coordinates: wall
                .sections
                .iter()
                .filter_map(|s| s.standing())
                .map(|s| s.map(pos).to_vec())
                .collect(),
        };
        let hit = k
            .overlay(&built, &routes, crate::spatial::Overlay::Intersection)
            .map_err(io::Error::other)?;
        let mut points = Vec::new();
        fn junctions(g: Geometry, points: &mut Vec<atlas_map::Position>) {
            match g {
                Geometry::Point { coordinates } => points.push(coordinates),
                Geometry::MultiPoint { coordinates } => points.extend(coordinates),
                Geometry::GeometryCollection { geometries } => {
                    for g in geometries {
                        junctions(g, points);
                    }
                }
                _ => {}
            }
        }
        if let Some(hit) = hit {
            junctions(hit, &mut points);
        }
        wall.gates = points.iter().copied().map(super::geometry::xy).collect();
        if points.is_empty() {
            continue;
        }
        let openings = k
            .buffer(
                &Geometry::MultiPoint {
                    coordinates: points,
                },
                8.,
            )
            .map_err(io::Error::other)?;
        if let Some(openings) = openings {
            let remaining = k
                .overlay(&built, &openings, crate::spatial::Overlay::Difference)
                .map_err(io::Error::other)?;
            wall.lines = remaining
                .iter()
                .flat_map(boundary_lines)
                .flat_map(|line| {
                    line.windows(2)
                        .map(|p| [super::geometry::xy(p[0]), super::geometry::xy(p[1])])
                        .collect::<Vec<_>>()
                })
                .collect();
        }
    }
    Ok(())
}
