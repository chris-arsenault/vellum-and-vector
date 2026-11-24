use super::{
    fields::{CityFields, RESIDENTS_PER_BUILT_KM2},
    geometry::{self, divide_by, faces, pos, xy},
    ground, Element, Urban,
};
use crate::{
    atlas::state::State,
    field::{geographic_regions, people::work::habitable, refinement::courses::cell_at},
    human::{catalogue::LayerId, HumanField},
    spatial::{Overlay, Predicate},
};
use atlas_map::{
    regions::{boundary_lines, parts, polygon},
    Geometry, Position,
};
use std::io;

// At City scale an avenue serves several neighborhoods; a block groups multiple
// Street-scale premises. Developed ground also calls for access in employment areas.
const AVENUE_RESIDENTS: f64 = 1_200.;
const BLOCK_RESIDENTS: f64 = 32.;

/// Estimate residents and developed ground across this face. Resample each child so a
/// dense neighborhood in one corner does not set the spacing for the whole district.
fn access_demand(
    state: &State,
    fields: &CityFields,
    face: &Geometry,
    residents_per_face: f64,
    largest_area: f64,
) -> io::Result<(f64, Option<[f64; 2]>)> {
    let k = state.spatial.as_ref();
    let atlas_map::Bounds(w, s, e, n) = k.bounds(face).map_err(io::Error::other)?;
    let probes: Vec<_> = (0..25)
        .map(|i| {
            Position::xy(
                w + (e - w) * ((i % 5) as f64 + 0.5) / 5.,
                s + (n - s) * ((i / 5) as f64 + 0.5) / 5.,
            )
        })
        .collect();
    let inside = k.covers_points(face, &probes).map_err(io::Error::other)?;
    let mut points: Vec<_> = probes
        .into_iter()
        .zip(inside)
        .filter_map(|(point, keep)| keep.then_some(point))
        .collect();
    if points.is_empty() {
        points.push(k.interior_position(face).map_err(io::Error::other)?);
    }
    let mut weight = 0.;
    let mut moment = [0.; 2];
    let f = state.field();
    let land = f.people().view(HumanField::Layer(LayerId::BuiltUp));
    for &point in &points {
        let Some(c) = cell_at(f.mesh(), xy(point)) else {
            continue;
        };
        let load = fields.route_demand(c, f.people().people(c)?, land.get(c)?);
        let [x, y] = xy(point);
        weight += load;
        moment[0] += (x - w) * load;
        moment[1] += (y - s) * load;
    }
    if weight == 0. {
        return Ok((largest_area, None));
    }
    Ok((
        (1e6 * residents_per_face * points.len() as f64 / weight).min(largest_area),
        Some([w + moment[0] / weight, s + moment[1] / weight]),
    ))
}

/// The planning area follows occupied, developed ground across coarse donor boundaries.
/// Sample a walkable neighborhood so a tract surrounded by residents can hold civic land.
pub(super) fn envelope(state: &State) -> io::Result<Option<Geometry>> {
    let f = state.field();
    let mesh = f.mesh();
    let built = f.people().view(HumanField::Layer(LayerId::BuiltUp));
    let mut intensity = Vec::with_capacity(mesh.len());
    for c in 0..mesh.len() {
        intensity.push(f.people().people(c)? / 1200. + built.get(c)? / 0.12);
    }
    let mut urban = Vec::new();
    let [ox, oy] = mesh.origin();
    for c in 0..mesh.len() {
        if !habitable(f, c)? {
            continue;
        }
        let [x, y] = mesh.position(c);
        let mut neighborhood = intensity[c].min(4.) * 2.;
        for a in 0..8 {
            let angle = std::f64::consts::TAU * a as f64 / 8.;
            if let Some(n) = cell_at(
                mesh,
                [ox + x + 420. * angle.cos(), oy + y + 420. * angle.sin()],
            ) {
                neighborhood += intensity[n].min(4.);
            }
        }
        if neighborhood > 10. {
            urban.push(c);
        }
    }
    let Some(outline) = geographic_regions::outline(state, &urban, None)? else {
        return Ok(None);
    };
    let Some(clipped) = state
        .spatial
        .overlay(
            &outline,
            state.scope.settled_outline(),
            Overlay::Intersection,
        )
        .map_err(io::Error::other)?
    else {
        return Ok(None);
    };
    let pieces = parts(&clipped);
    let anchor = crate::atlas::regional::city::settlement(state)?.map(|s| pos(s.centre));
    let Some(centre) = anchor else {
        return Ok(None);
    };
    let kernel = state.spatial.as_ref();
    let mut patches = Vec::new();
    for g in pieces {
        if kernel.area(&g).map_err(io::Error::other)? > mesh.spacing().powi(2) {
            patches.push(g);
        }
    }
    if patches.is_empty() {
        return Ok(None);
    }
    // Districtable land on opposite sides of a river can belong to the same city.
    // Group adjacent developed tracts at walking distance, then use their actual dry outlines.
    let mut buffers = Vec::new();
    for patch in &patches {
        if let Some(buffer) = kernel.buffer(patch, 220.).map_err(io::Error::other)? {
            buffers.push(buffer);
        }
    }
    let Some(neighborhoods) = kernel.union_all(&buffers).map_err(io::Error::other)? else {
        return Ok(None);
    };
    let clusters = parts(&neighborhoods);
    let Some(i) = kernel
        .index(&clusters)
        .map_err(io::Error::other)?
        .nearest(centre)
        .map_err(io::Error::other)?
    else {
        return Ok(None);
    };
    let included = kernel
        .relations(&clusters[i], &patches, Predicate::Intersects)
        .map_err(io::Error::other)?;
    let occupied: Vec<_> = patches
        .into_iter()
        .zip(included)
        .filter_map(|(g, yes)| yes.then_some(g))
        .collect();
    let Some(mut domain) = kernel.union_all(&occupied).map_err(io::Error::other)? else {
        return Ok(None);
    };
    let walls = crate::atlas::regional::city::wall_lines(state)?;
    if !walls.is_empty() {
        let lines = Geometry::MultiLineString {
            coordinates: walls
                .into_iter()
                .map(|pair| pair.into_iter().map(pos).collect())
                .collect(),
        };
        if let Some(walls) = kernel.buffer(&lines, 2.).map_err(io::Error::other)? {
            let Some(rest) = kernel
                .overlay(&domain, &walls, Overlay::Difference)
                .map_err(io::Error::other)?
                .and_then(polygon)
            else {
                return Ok(None);
            };
            domain = rest;
        }
    }
    Ok(Some(domain))
}
pub(super) fn primary(
    state: &State,
    urban: &mut Urban,
    domain: Geometry,
    approaches: Vec<crate::features::Feature>,
) -> io::Result<()> {
    let kernel = state.spatial.as_ref();
    let patches = parts(&domain);
    let patch_index = kernel.index(&patches).map_err(io::Error::other)?;
    let anchor = crate::atlas::regional::city::settlement(state)?
        .ok_or_else(|| io::Error::other("City lacks its settlement origin"))?;
    let Some(core) = patch_index
        .nearest(pos(anchor.centre))
        .map_err(io::Error::other)?
    else {
        return Ok(());
    };
    let mut linked = vec![false; patches.len()];
    linked[core] = true;
    let mut access = Vec::new();
    for f in &approaches {
        if f.attributes.get("wayKind").and_then(|v| v.as_str()) == Some("sea") {
            continue;
        }
        for trace in boundary_lines(&f.geometry) {
            let road = Geometry::LineString { coordinates: trace };
            let mut reaches = Vec::new();
            for i in patch_index
                .query(kernel.bounds(&road).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
            {
                if kernel
                    .relation(&patches[i], &road, Predicate::Intersects)
                    .map_err(io::Error::other)?
                {
                    reaches.push(i);
                }
            }
            if !reaches.is_empty() {
                access.push((road, reaches, &f.name));
            }
        }
    }
    loop {
        let mut changed = false;
        for (_, reaches, _) in &access {
            if reaches.iter().any(|&i| linked[i]) {
                for &i in reaches {
                    changed |= !linked[i];
                    linked[i] = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    let connected: Vec<_> = patches
        .into_iter()
        .zip(&linked)
        .filter_map(|(g, &yes)| yes.then_some(g))
        .collect();
    let Some(mut domain) = kernel.union_all(&connected).map_err(io::Error::other)? else {
        return Ok(());
    };
    let extent = state
        .scope
        .outline
        .as_ref()
        .unwrap_or(&state.scope.footprint);
    // A bridge or approach between separate developed tracts supplies their common
    // access. Its right of way is part of the city; its rural approaches beyond the
    // last tract stay outside. A small compound can thus share a district across it.
    let mut crossings = Vec::new();
    for (road, reaches, _) in &access {
        if reaches.len() < 2 || !reaches.iter().any(|&i| linked[i]) {
            continue;
        }
        let Some(outside) = kernel
            .overlay(road, &domain, Overlay::Difference)
            .map_err(io::Error::other)?
        else {
            continue;
        };
        for line in boundary_lines(&outside) {
            let (Some(first), Some(last)) = (line.first(), line.last()) else {
                continue;
            };
            let near = |p| -> io::Result<Option<usize>> {
                Ok(patch_index
                    .nearest_with_distance(p)
                    .map_err(io::Error::other)?
                    .filter(|(_, distance)| *distance <= state.scope.precision)
                    .map(|(i, _)| i))
            };
            if let (Some(a), Some(b)) = (near(*first)?, near(*last)?) {
                if a != b {
                    let line = Geometry::LineString { coordinates: line };
                    if let Some(strip) = kernel.buffer(&line, 8.).map_err(io::Error::other)? {
                        if let Some(strip) = kernel
                            .overlay(&strip, state.scope.settled_outline(), Overlay::Intersection)
                            .map_err(io::Error::other)?
                            .and_then(polygon)
                        {
                            crossings.push(strip);
                        }
                    }
                }
            }
        }
    }
    if !crossings.is_empty() {
        crossings.push(domain);
        domain = kernel
            .union_all(&crossings)
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("Connected urban ground requires an area"))?;
    }
    let mut inherited = Vec::new();
    for (road, reaches, name) in access {
        if !reaches.iter().any(|&i| linked[i]) {
            continue;
        }
        for (mask, primary) in [(&domain, true), (extent, false)] {
            if let Some(g) = kernel.clip_trace(&road, mask).map_err(io::Error::other)? {
                for coordinates in boundary_lines(&g) {
                    let part = Geometry::LineString { coordinates };
                    if primary {
                        inherited.push(part);
                    } else {
                        let mut way = Element::way(part, "thoroughfare", "Approach", 16.);
                        way.name = name.clone();
                        urban.routes.push(way);
                    }
                }
            }
        }
    }
    let mut angle = 0.37;
    let mut longest = 0.;
    for way in &inherited {
        for points in boundary_lines(way) {
            for pair in points.windows(2) {
                let [a, b] = [xy(pair[0]), xy(pair[1])];
                let len = (b[0] - a[0]).hypot(b[1] - a[1]);
                if len > longest {
                    longest = len;
                    angle = (b[1] - a[1]).atan2(b[0] - a[0]);
                }
            }
        }
    }
    let initial = faces(kernel, &domain, &inherited)?;
    let city_area = kernel.area(&domain).map_err(io::Error::other)?;
    let precinct_area = city_area / (2 * super::partition::DISTRICT_COUNT.end()) as f64;
    urban.orientation = angle;
    for (i, ward) in initial.iter().enumerate() {
        let division = divide_by(kernel, ward, angle, 901 + i as u64, |face| {
            access_demand(state, &urban.fields, face, AVENUE_RESIDENTS, precinct_area)
        })?;
        urban.routes.extend(
            division
                .ways
                .into_iter()
                .map(|g| Element::way(g, "thoroughfare", "Avenue", 14.)),
        );
        // The perimeter joins the cut ends, including an approach that terminates in town.
    }
    if let Some(perimeter) = kernel.boundary(&domain).map_err(io::Error::other)? {
        urban
            .routes
            .push(Element::way(perimeter, "thoroughfare", "Perimeter way", 7.));
    }
    let spine: Vec<_> = urban.routes.iter().map(|e| e.geometry.clone()).collect();
    let index = kernel.index(&spine).map_err(io::Error::other)?;
    let mesh = state.field().mesh();
    let [ox, oy] = mesh.origin();
    for (family, cell) in state.regional.iter().flat_map(|r| r.city.works.iter()) {
        let [x, y] = mesh.position(*cell as usize);
        let site = Position::xy(x + ox, y + oy);
        if !kernel
            .covers_points(&domain, &[site])
            .map_err(io::Error::other)?[0]
        {
            continue;
        }
        let Some(i) = index.nearest(site).map_err(io::Error::other)? else {
            continue;
        };
        let [_, on] = kernel
            .nearest_points(&Geometry::Point { coordinates: site }, &spine[i])
            .map_err(io::Error::other)?;
        if crate::town::geometry::distance(xy(site), xy(on)) < 2. {
            continue;
        }
        let approach = Geometry::LineString {
            coordinates: vec![on, site],
        };
        if kernel
            .relation(&domain, &approach, Predicate::Covers)
            .map_err(io::Error::other)?
        {
            let mut route = Element::way(approach, "thoroughfare", "Civic approach", 9.);
            route
                .attributes
                .insert("destination".into(), family.label().into());
            urban.routes.push(route);
        }
    }
    urban.fields.record_routes(state, &urban.routes)?;
    urban.domain = Some(domain);
    Ok(())
}
pub(super) fn districts(
    state: &State,
    urban: &mut Urban,
    domain: &Geometry,
    retained: Vec<crate::features::Feature>,
) -> io::Result<()> {
    let kernel = state.spatial.as_ref();
    let ways = urban
        .routes
        .iter()
        .map(|r| r.geometry.clone())
        .collect::<Vec<_>>();
    let mut polygons = faces(kernel, domain, &ways)?;
    let frame = state
        .scope
        .outline
        .as_ref()
        .unwrap_or(&state.scope.footprint);
    for f in retained {
        let Some(f) = super::within_frame(kernel, f, frame)? else {
            continue;
        };
        let mut vacant = Vec::new();
        for face in polygons {
            if let Some(g) = kernel
                .overlay(&face, &f.geometry, Overlay::Difference)
                .map_err(io::Error::other)?
            {
                vacant.extend(parts(&g));
            }
        }
        polygons = vacant;
        urban.captured.push(f);
    }
    if polygons.is_empty() {
        return Ok(());
    }
    let f = state.field();
    let mesh = f.mesh();
    let built = f.people().view(HumanField::Layer(LayerId::BuiltUp));
    let cells: Vec<_> = (0..mesh.len())
        .map(|c| geometry::ring(&crate::lattice::hexes::triangle_corners(mesh, c)))
        .collect();
    let index = kernel.index(&cells).map_err(io::Error::other)?;
    let [ox, oy] = mesh.origin();
    let works: Vec<_> = state
        .regional
        .iter()
        .flat_map(|r| &r.city.works)
        .map(|(_, cell)| {
            let [x, y] = mesh.position(*cell as usize);
            Position::xy(ox + x, oy + y)
        })
        .collect();
    let mut precincts = Vec::new();
    for g in polygons {
        let ids = index
            .query(kernel.bounds(&g).map_err(io::Error::other)?)
            .map_err(io::Error::other)?;
        let support: Vec<_> = ids.iter().map(|&c| cells[c].clone()).collect();
        let areas = kernel
            .intersection_areas(&g, &support)
            .map_err(io::Error::other)?;
        let mut residents = 0.;
        let mut developed = 0.;
        let mut service_load = 0.;
        for (cell, m2) in ids.into_iter().zip(areas) {
            let local_people = f.people().people(cell)?;
            residents += local_people * m2 / 1e6;
            developed += built.get(cell)? * m2 / 1e6;
            service_load += urban.fields.access(cell)
                * (local_people + RESIDENTS_PER_BUILT_KM2 * urban.fields.frontage(cell))
                * m2
                / 1e6;
        }
        let area = kernel.area(&g).map_err(io::Error::other)?;
        if area <= 0. {
            continue;
        }
        let works = kernel
            .covers_points(&g, &works)
            .map_err(io::Error::other)?
            .into_iter()
            .filter(|yes| *yes)
            .count();
        precincts.push(super::partition::Precinct {
            shape: g,
            area,
            residents,
            built: developed,
            service_load,
            works,
        });
    }
    let approaches: Vec<_> = urban
        .routes
        .iter()
        .filter(|r| r.attributes.get("class").and_then(|v| v.as_str()) == Some("Approach"))
        .map(|r| r.geometry.clone())
        .collect();
    let target = super::partition::target(precincts.iter().map(|p| p.residents).sum());
    let retained = urban
        .captured
        .iter()
        .filter(|f| f.kind == "district")
        .count();
    let districts = super::partition::partition(
        kernel,
        &precincts,
        &approaches,
        target.saturating_sub(retained),
    )?;
    for (i, group) in districts.into_iter().enumerate() {
        let members = group.precincts.iter().map(|&j| &precincts[j]);
        let residents: f64 = members.clone().map(|p| p.residents).sum();
        let developed: f64 = members.clone().map(|p| p.built).sum();
        let area: f64 = members.clone().map(|p| p.area).sum();
        let shapes: Vec<_> = members.map(|p| p.shape.clone()).collect();
        let g = kernel
            .union_all(&shapes)
            .map_err(io::Error::other)?
            .ok_or_else(|| io::Error::other("District precincts require polygonal ground"))?;
        let label = if residents / (area / 1e6) > 1800. {
            "Central"
        } else {
            "Outer"
        };
        let mut district = Element::new(g, "district", &format!("{label} Quarter {}", i + 1));
        district
            .attributes
            .insert("districtNumber".into(), (i + 1).into());
        district.attributes.insert(
            "adjoiningDistricts".into(),
            serde_json::json!(group
                .neighbors
                .into_iter()
                .map(|n| n + 1)
                .collect::<Vec<_>>()),
        );
        district
            .attributes
            .insert("population".into(), residents.round().into());
        district
            .attributes
            .insert("builtKm2".into(), developed.into());
        district
            .attributes
            .insert("builtShare".into(), (developed * 1e6 / area).into());
        district
            .attributes
            .insert("densityPerKm2".into(), (residents * 1e6 / area).into());
        district.attributes.insert("urbanPlan".into(), true.into());
        urban.districts.push(district);
    }
    Ok(())
}

pub(super) fn record_activity(state: &State, urban: &mut Urban) -> io::Result<()> {
    let zones = urban
        .districts
        .iter()
        .map(|d| (&d.geometry, &d.attributes))
        .chain(
            urban
                .captured
                .iter()
                .filter(|f| f.kind == "district")
                .map(|f| (&f.geometry, &f.attributes)),
        )
        .map(|(g, a)| {
            let value = |name| {
                a.get(name)
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or_default()
            };
            (
                g,
                0.5 * (value("densityPerKm2") + RESIDENTS_PER_BUILT_KM2 * value("builtShare")),
            )
        });
    urban.fields.record_districts(state, zones)
}

pub(super) fn blocks(
    state: &State,
    urban: &mut Urban,
    domain: &Geometry,
    reserved: &[crate::features::Feature],
) -> io::Result<()> {
    let k = state.spatial.as_ref();
    let inherited = urban
        .captured
        .iter()
        .filter(|f| f.kind == "district")
        .map(|f| Element::new(f.geometry.clone(), "district", &f.name));
    let mains: Vec<_> = urban
        .routes
        .iter()
        .filter(|r| r.name != "Perimeter way")
        .map(|r| r.geometry.clone())
        .collect();
    let arteries = k.index(&mains).map_err(io::Error::other)?;
    let precincts = faces(k, domain, &mains)?;
    let precinct_index = k.index(&precincts).map_err(io::Error::other)?;
    let mut rights_of_way = Vec::new();
    for route in &urban.routes {
        let width = route.attributes["widths"]
            .get(0)
            .and_then(|v| v.as_f64())
            .unwrap_or(7.);
        if let Some(strip) = k
            .buffer(&route.geometry, width / 2.)
            .map_err(io::Error::other)?
        {
            rights_of_way.push(strip);
        }
    }
    let road_land = k.index(&rights_of_way).map_err(io::Error::other)?;
    let mesh = state.field().mesh();
    let [ox, oy] = mesh.origin();
    let works: Vec<_> = state
        .regional
        .iter()
        .flat_map(|r| r.city.works.iter())
        .map(|(_, cell)| {
            let [x, y] = mesh.position(*cell as usize);
            Geometry::Point {
                coordinates: Position::xy(x + ox, y + oy),
            }
        })
        .collect();
    let institutions = k.index(&works).map_err(io::Error::other)?;
    for (i, d) in urban.districts.iter().cloned().chain(inherited).enumerate() {
        let angle = urban.orientation + (geometry::sample(i as u64) - 0.5) * 0.42;
        let Some(mut land) = super::buildable(k, d.geometry.clone(), reserved)? else {
            continue;
        };
        {
            let Some(region) = k
                .overlay(&land, domain, Overlay::Intersection)
                .map_err(io::Error::other)?
                .and_then(polygon)
            else {
                continue;
            };
            land = region;
        }
        // Connect the ends of local streets to avenue centrelines. Reserve the width
        // of the carriageway when laying out the adjoining blocks.
        let precincts_here: Vec<_> = precinct_index
            .query(k.bounds(&land).map_err(io::Error::other)?)
            .map_err(io::Error::other)?
            .into_iter()
            .map(|i| precincts[i].clone())
            .collect();
        let geometries = k
            .overlays(&land, &precincts_here, Overlay::Intersection)
            .map_err(io::Error::other)?
            .into_iter()
            .flatten()
            .filter_map(polygon)
            .collect();
        let division = divide_by(
            k,
            &Geometry::GeometryCollection { geometries },
            angle,
            43 + i as u64,
            |face| access_demand(state, &urban.fields, face, BLOCK_RESIDENTS, f64::INFINITY),
        )?;
        let mut prominent = None;
        for way in division.ways {
            urban
                .proposed_access
                .push(Element::way(way, "thoroughfare", "Block street", 7.));
        }
        'parcels: for (j, parcel) in division.faces.iter().enumerate() {
            let anchor = k.interior_position(parcel).map_err(io::Error::other)?;
            let (people, built, standing) = ground(state, anchor)?;
            let civic = institutions
                .nearest_with_distance(anchor)
                .map_err(io::Error::other)?
                .map_or(f64::INFINITY, |(_, d)| d);
            let access = arteries
                .nearest_with_distance(anchor)
                .map_err(io::Error::other)?
                .map_or(0., |(_, d)| 1. / (1. + d / 95.));
            let sample = geometry::sample(57 + i as u64 * 547 + j as u64);
            let Some(mut shape) = k
                .buffer(parcel, -4.)
                .map_err(io::Error::other)?
                .and_then(polygon)
            else {
                continue;
            };
            for road in road_land
                .query(k.bounds(&shape).map_err(io::Error::other)?)
                .map_err(io::Error::other)?
            {
                let Some(rest) = k
                    .overlay(&shape, &rights_of_way[road], Overlay::Difference)
                    .map_err(io::Error::other)?
                    .and_then(polygon)
                else {
                    continue 'parcels;
                };
                shape = rest;
            }
            let market = access > 0.65 && civic < 320. && sample < 0.38;
            // Sparse tracts retain their existing ground cover away from serviced
            // frontage. A gap in development need not be a designed market or green.
            let Some(c) = cell_at(mesh, xy(anchor)) else {
                continue;
            };
            let walking = urban.fields.access(c);
            let activity = urban.fields.activity(c);
            let standing_share = standing / crate::human::catalogue::FULL_STANDING_PER_BUILT_KM2;
            let supported = people / 1200. + (built + standing_share) / 0.12;
            if supported * (0.25 + walking + activity / (1200. + activity)) < 1. && civic > 320. {
                continue;
            }
            let common = sample < 0.04;
            if market || common {
                let mut place = Element::new(
                    shape,
                    "square",
                    if market {
                        "Market square"
                    } else {
                        "Common green"
                    },
                );
                place.attributes.insert("urbanPlan".into(), true.into());
                urban.open.push(place);
                continue;
            }
            let usage = if civic < 100. {
                "civic"
            } else if access > 0.38 && sample < 0.16 + 0.57 * access {
                "business"
            } else if access > 0.25 && people < 1100. && sample < 0.4 {
                "industry"
            } else {
                "residential"
            };
            let mut block = Element::new(shape, "cityBlock", "City block");
            if let Some((score, place)) =
                landmark(state, anchor, usage, people, built, standing, access)?
            {
                if prominent.as_ref().is_none_or(|(best, _, _)| score > *best) {
                    prominent = Some((score, urban.blocks.len(), place));
                }
            }
            for (key, value) in [
                ("use", usage.into()),
                ("density", people.into()),
                ("standing", standing.into()),
                ("builtShare", built.into()),
                ("walkingAccess", walking.into()),
                ("districtActivity", activity.into()),
                ("orientation", angle.into()),
                ("urbanPlan", true.into()),
            ] {
                block.attributes.insert(key.into(), value);
            }
            urban.blocks.push(block);
        }
        if let Some((_, index, place)) = prominent {
            urban.blocks[index]
                .attributes
                .insert("place".into(), place.name.clone().into());
            urban.landmarks.push(place);
        }
    }
    urban.fields.record_frontage(state, &urban.blocks)
}

/// The supported use and the catalogue's local conditions decide which city landmark
/// stands out. This reads the blocks already allocated to the district.
fn landmark(
    state: &State,
    anchor: Position,
    usage: &str,
    people: f64,
    built: f64,
    standing: f64,
    access: f64,
) -> io::Result<Option<(f64, Element)>> {
    use crate::town::{
        catalogue::{Activity, PlaceRules, PLACES},
        city::CityReading,
    };
    let activity = match usage {
        "civic" => Activity::Institution,
        "business" => Activity::Trade,
        "industry" => Activity::Production,
        _ => return Ok(None),
    };
    let field = state.field();
    let mesh = field.mesh();
    let Some(c) = cell_at(mesh, xy(anchor)) else {
        return Ok(None);
    };
    let maturity = standing.max(0.)
        / (standing.max(0.) + built * crate::human::catalogue::FULL_STANDING_PER_BUILT_KM2 + 1.);
    let reading = CityReading {
        density: people / (people + 1400.),
        built: built / (built + 0.08),
        standing: maturity,
        wealth: maturity,
        ways: (4. * access).round() as u32,
        fringe: 1. / (1. + people / 1000.),
        seat: usage == "civic",
        shore: (0..3)
            .filter_map(|e| mesh.neighbor(c, e))
            .try_fold(false, |wet, n| {
                Ok::<_, io::Error>(wet || !habitable(field, n)?)
            })?,
        ..Default::default()
    };
    Ok(PLACES
        .iter()
        .map(|k| k.definition())
        .filter(|d| d.activity == activity)
        .filter_map(|d| {
            let appearance = d.city.appearance()?;
            let score = (appearance.raised_by)(&reading) * d.prominence;
            (score > 0.).then_some((score, d.label, appearance))
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(score, label, appearance)| {
            let mut mark = Element::new(
                Geometry::Point {
                    coordinates: anchor,
                },
                "cityPlace",
                label,
            );
            mark.attributes.insert("place".into(), label.into());
            mark.attributes
                .insert("symbol".into(), appearance.symbol.into());
            mark.attributes
                .insert("groundM2".into(), appearance.ground.into());
            (score, mark)
        }))
}
