//! Recover local access inside the ground the City already records as built.
use super::geometry::{divide, pos, xy};
use crate::{
    spatial::{Overlay, SpatialKernel},
    town::{
        fabric::Town,
        founding::TractAccess,
        geometry::{angle, distance, dot, sub, unit, Point},
        ground::Ground,
        growth::{line, StreetLines},
        network::{lane, stops_lane, Class},
        settings::JUNCTION_TOLERANCE,
    },
};
use atlas_map::{
    regions::{boundary_lines, point, polygon},
    Bounds, Geometry,
};
use std::io;

/// A City land-use polygon may cover several square kilometres. Resolve it
/// into occupations at the same quarter scale used by its City template.
pub(crate) fn quarters(
    tracts: Vec<crate::town::fabric::DistrictTract>,
    town: &Town,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<crate::town::fabric::DistrictTract>> {
    let mut result = Vec::new();
    let quarter = town.template.quarter().powi(2);
    for (i, tract) in tracts.into_iter().enumerate() {
        if tract.developed_m2 <= quarter {
            result.push(tract);
            continue;
        }
        let area = spatial.area(&tract.area).map_err(io::Error::other)?;
        let origin = xy(spatial
            .interior_position(&tract.area)
            .map_err(io::Error::other)?);
        let axis = town
            .template
            .align(origin)
            .unwrap_or_else(|| sub(origin, town.seat.centre));
        let parts = divide(
            spatial,
            &tract.area,
            area * quarter / tract.developed_m2,
            angle(axis),
            i as u64,
        )?;
        for face in parts.faces {
            let developed_m2 =
                tract.developed_m2 * spatial.area(&face).map_err(io::Error::other)? / area;
            result.push(crate::town::fabric::DistrictTract {
                area: face,
                developed_m2,
                ..tract.clone()
            });
        }
    }
    Ok(result)
}

struct Quarter {
    origin: Point,
    area: Geometry,
    developed: f64,
    index: usize,
}

type StreetEntry = (usize, Point);

pub(crate) fn streets(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<Option<TractAccess>>> {
    let Some(district) = &town.district else {
        return Ok(Vec::new());
    };
    let mut origins = vec![None; district.tracts.len()];
    let mut quarters = Vec::new();
    for (index, tract) in district.tracts.iter().enumerate() {
        if tract.built_share.unwrap_or(0.) > 0.
            && tract.density_per_km2.unwrap_or(0.) > 0.
            && tract.developed_m2 > 0.
        {
            quarters.push(Quarter {
                origin: tract.origin(town.seat.centre, spatial)?,
                area: tract.area.clone(),
                developed: tract.developed_m2,
                index,
            });
        }
    }
    // hpc-exempt: resolve connected neighbourhoods outward from the City's district seat.
    quarters.sort_by(|a, b| {
        distance(a.origin, town.seat.centre).total_cmp(&distance(b.origin, town.seat.centre))
    });
    let depth = town.plot().1;
    let block_width = 2. * depth + town.street_form(Class::Street).width();
    if town.streets().is_empty() {
        seed_district_street(town, ground, spatial, &quarters, block_width)?;
    }
    for (seed, quarter) in quarters.iter().enumerate() {
        origins[quarter.index] = Some(lay_quarter(
            town,
            ground,
            spatial,
            quarter,
            block_width,
            seed as u64,
        )?);
    }
    Ok(origins)
}

fn seed_district_street(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    quarters: &[Quarter],
    block_width: f64,
) -> io::Result<()> {
    let mut founders: Vec<_> = quarters.iter().collect();
    let weight =
        |q: &Quarter| q.developed / (block_width + distance(q.origin, town.seat.centre)).powi(2);
    // hpc-exempt: prefer larger inhabited tracts near the district seat for its first public street.
    founders.sort_by(|a, b| weight(b).total_cmp(&weight(a)));
    for q in founders {
        let bearing = town
            .template
            .align(q.origin)
            .unwrap_or_else(|| sub(town.seat.centre, q.origin));
        let reach = (q.developed / (4. * town.plot().1)).min(q.developed.sqrt());
        if let Some(street) = crate::town::founding::survey_public_street(
            town,
            ground,
            q.origin,
            reach,
            angle(bearing),
        ) {
            if town.connect_route(street, 2., spatial)? {
                break;
            }
        }
    }
    Ok(())
}

struct Frontages {
    frontage: Vec<Vec<atlas_map::Position>>,
    serving: Vec<usize>,
    avenue: Option<(f64, Point)>,
}
fn quarter_frontages(
    town: &Town,
    spatial: &dyn SpatialKernel,
    area: &Geometry,
    origin: Point,
    approach: Option<StreetEntry>,
) -> io::Result<Frontages> {
    let mut frontage = Vec::new();
    let mut serving = Vec::new();
    let mut avenue = None;
    // The City supplies the extent and the developed area of this quarter.
    // Follow its streets across the tract; the area controls how far the
    // inhabited blocks reach behind them.
    let bounds = spatial.bounds(area).map_err(io::Error::other)?;
    for id in town.nearby_roads(bounds, spatial)? {
        let road = &town.streets()[id];
        let trace = line(&road.points);
        let mut section = spatial
            .overlay(&trace, area, Overlay::Intersection)
            .map_err(io::Error::other)?;
        // A boundary avenue may supply a row on this side while its centreline stays outside.
        if section.is_none()
            && approach.is_some_and(|(i, p)| {
                i == id && distance(origin, p) <= road.width() / 2. + atlas_map::town::VERGE
            })
        {
            if let Some(edge) = spatial
                .buffer(area, road.width() / 2. + atlas_map::town::VERGE)
                .map_err(io::Error::other)?
            {
                section = spatial
                    .overlay(&trace, &edge, Overlay::Intersection)
                    .map_err(io::Error::other)?;
            }
        }
        if let Some(section) = section {
            let parts = boundary_lines(&section);
            if !parts.is_empty() {
                serving.push(id);
            }
            for part in parts {
                if town.streets()[id].class == Class::Main && part.len() >= 2 {
                    let direction = sub(xy(*part.last().unwrap()), xy(part[0]));
                    let length = dot(direction, direction);
                    if length > 0. && avenue.is_none_or(|(longest, _)| length > longest) {
                        avenue = Some((length, direction));
                    }
                }
                frontage.push(part);
            }
        }
    }

    Ok(Frontages {
        frontage,
        serving,
        avenue,
    })
}
fn lay_quarter(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    quarter: &Quarter,
    block_width: f64,
    seed: u64,
) -> io::Result<TractAccess> {
    let area = &quarter.area;
    let developed = quarter.developed;
    let (front, depth) = town.plot();
    let (origin, approach) = served_site(town, spatial, area, quarter.origin, developed)?;
    let start = approach.map(|(_, p)| p);
    let Frontages {
        mut frontage,
        mut serving,
        avenue,
    } = quarter_frontages(town, spatial, area, origin, approach)?;
    let needs_feeder = |&(street, p): &StreetEntry| {
        frontage.is_empty()
            && developed >= 2. * front * depth
            && distance(p, origin) > town.streets()[street].width() / 2. + front
    };
    if let Some(entry) = approach.filter(needs_feeder) {
        if let Some(link) = enter_quarter(town, ground, spatial, entry, origin, block_width)? {
            if let Some(section) = spatial.clip_trace(&link, area).map_err(io::Error::other)? {
                frontage.extend(boundary_lines(&section));
                serving.push(town.streets().len() - 1);
            }
        }
    }
    serving.sort_unstable();
    let already_served = !frontage.is_empty();
    let access = TractAccess {
        origin,
        streets: serving,
    };
    let axis_geometry = if frontage.is_empty() {
        point(pos(origin))
    } else {
        Geometry::MultiLineString {
            coordinates: frontage,
        }
    };
    let land = occupied_land(spatial, area, &axis_geometry, developed, depth)?;
    if already_served {
        if let Some(row) = spatial
            .buffer(&axis_geometry, depth)
            .map_err(io::Error::other)?
        {
            if spatial
                .relation(&row, &land, crate::spatial::Predicate::Covers)
                .map_err(io::Error::other)?
            {
                return Ok(access);
            }
        }
    }
    let axis = town
        .template
        .align(origin)
        .or_else(|| avenue.map(|(_, direction)| direction))
        .or_else(|| start.map(|p| sub(origin, p)))
        .unwrap_or_else(|| sub(origin, town.seat.centre));
    let blocks = divide(spatial, &land, block_width * block_width, angle(axis), seed)?;
    let first_local = town.streets().len();
    for part in blocks.ways.iter().flat_map(boundary_lines) {
        open_block_street(
            town,
            ground,
            spatial,
            part.into_iter().map(xy).collect(),
            block_width,
        )?;
    }
    join_block_ends(town, first_local, area, block_width, ground, spatial)?;
    Ok(access)
}

/// A long precinct can already adjoin a working street far from its polygon's centre.
/// Put its first premises at that frontage before cutting a new way across open land.
fn served_site(
    town: &Town,
    spatial: &dyn SpatialKernel,
    area: &Geometry,
    origin: Point,
    developed: f64,
) -> io::Result<(Point, Option<StreetEntry>)> {
    let closest = town.project_onto_road(origin, spatial)?;
    let Some((_, p)) = closest else {
        return Ok((origin, None));
    };
    if distance(p, origin) <= JUNCTION_TOLERANCE
        || (distance(p, origin) <= (developed / std::f64::consts::PI).sqrt()
            && spatial
                .relation(area, &line(&[origin, p]), crate::spatial::Predicate::Covers)
                .map_err(io::Error::other)?)
    {
        return Ok((origin, closest));
    }
    let Bounds(w, s, e, n) = spatial.bounds(area).map_err(io::Error::other)?;
    let verge = town
        .scale()
        .length(atlas_map::town::VERGE, crate::town::scale::Measure::Plot);
    let mut best = None;
    let desired = point(pos(origin));
    for i in town.nearby_roads(Bounds(w - verge, s - verge, e + verge, n + verge), spatial)? {
        let street = &town.streets()[i];
        let trace = line(&street.points);
        let (road, land) = match spatial
            .overlay(&trace, area, Overlay::Intersection)
            .map_err(io::Error::other)?
        {
            Some(section) => {
                let [p, _] = spatial
                    .nearest_points(&section, &desired)
                    .map_err(io::Error::other)?;
                (xy(p), xy(p))
            }
            None => {
                if spatial.distance(&trace, area).map_err(io::Error::other)?
                    > street.width() / 2. + verge
                {
                    continue;
                }
                let Some(edge) = street.corridor(verge, spatial).map_err(io::Error::other)? else {
                    continue;
                };
                let Some(contact) = spatial
                    .overlay(area, &edge, Overlay::Intersection)
                    .map_err(io::Error::other)?
                else {
                    continue;
                };
                // A parallel road may serve an entire tract boundary. Choose frontage
                // near the occupied centre using the actual width there.
                let [land, _] = spatial
                    .nearest_points(&contact, &desired)
                    .map_err(io::Error::other)?;
                let [road, _] = spatial
                    .nearest_points(&trace, &point(land))
                    .map_err(io::Error::other)?;
                (xy(road), xy(land))
            }
        };
        let gap = distance(road, land);
        let cost = gap + distance(origin, land);
        if best.is_none_or(|(score, _, _, _)| cost < score) {
            best = Some((cost, land, i, road));
        }
    }
    Ok(best.map_or((origin, closest), |(_, land, i, p)| (land, Some((i, p)))))
}

fn enter_quarter(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    (street, from): StreetEntry,
    to: Point,
    block_width: f64,
) -> io::Result<Option<Geometry>> {
    if lay(town, ground, spatial, &[from, to], Class::Street)? {
        return Ok(Some(line(&[from, to])));
    }
    // Follow the same width-aware survey that finds working byways around a
    // hillside or wall. A partly surveyed route cannot serve this quarter.
    let gap = distance(from, to);
    let class = Class::Lane;
    let width = town.street_form(class).width();
    let journey = crate::town::byway::Journey {
        departure: from,
        destination: to,
        unserved_distance: gap,
    };
    let Some(path) = crate::town::byway::connection(
        &town.streets()[street],
        journey,
        ground,
        width,
        gap * std::f64::consts::SQRT_2 + block_width,
    ) else {
        return Ok(None);
    };
    if distance(*path.last().unwrap(), to) > width.max(ground.cell) {
        return Ok(None);
    }
    let trace = line(&path);
    let lane =
        crate::town::network::Street::new_at(path, class, town.seat.story.size(), town.scale());
    Ok(town.connect_route(lane, 2., spatial)?.then_some(trace))
}

/// An avenue on a tract boundary supplies frontage on only one side. Overlapping
/// avenues also serve some of the same land. Measure the ground inside the tract
/// before deciding how far the occupied blocks reach behind those streets.
fn occupied_land(
    spatial: &dyn SpatialKernel,
    catchment: &Geometry,
    axes: &Geometry,
    developed: f64,
    plot_depth: f64,
) -> io::Result<Geometry> {
    if spatial.area(catchment).map_err(io::Error::other)? <= developed {
        return Ok(catchment.clone());
    }
    let length = spatial.length(axes).map_err(io::Error::other)?;
    let Bounds(w, s, e, n) = spatial.bounds(catchment).map_err(io::Error::other)?;
    // Each axis meets the catchment. A buffer wider than its diagonal covers it.
    let extent = (e - w).hypot(n - s) * 2.;
    let mut low = 0.;
    let mut radius =
        developed / (length + (length * length + std::f64::consts::PI * developed).sqrt());
    let mut high = extent;
    let mut best = catchment.clone();
    loop {
        if high - low <= plot_depth {
            return Ok(best);
        }
        radius = radius.min((high + low) * 0.5);
        let corridor = spatial.buffer(axes, radius).map_err(io::Error::other)?;
        let land = match corridor {
            Some(shape) => spatial
                .overlay(catchment, &shape, Overlay::Intersection)
                .map_err(io::Error::other)?
                .and_then(polygon),
            None => None,
        };
        if let Some(land) = land {
            if spatial.area(&land).map_err(io::Error::other)? >= developed {
                best = land;
                high = radius;
            } else {
                low = radius;
            }
        } else {
            low = radius;
        }
        radius = (radius * 2.).max(plot_depth);
    }
}

type StreetEnd = (Point, Point, usize);

fn unconnected_ends(
    town: &Town,
    first: usize,
    spatial: &dyn SpatialKernel,
) -> io::Result<Vec<StreetEnd>> {
    let mut ends = Vec::new();
    for (id, s) in town.streets().iter().enumerate().skip(first) {
        for (a, b) in [(0, 1), (s.points.len() - 1, s.points.len() - 2)] {
            let p = s.points[a];
            let d = JUNCTION_TOLERANCE;
            let nearby =
                town.nearby_roads(Bounds(p[0] - d, p[1] - d, p[0] + d, p[1] + d), spatial)?;
            let mut joined = false;
            for i in nearby.into_iter().filter(|&i| i != id) {
                if spatial
                    .distance(&line(&town.streets()[i].points), &point(pos(p)))
                    .map_err(io::Error::other)?
                    <= d
                {
                    joined = true;
                    break;
                }
            }
            if !joined {
                ends.push((p, unit(sub(p, s.points[b])), id));
            }
        }
    }
    Ok(ends)
}

/// The short ends of adjoining blocks can share a back street. Only pair
/// parallel departures across one block, on ground belonging to this tract.
fn join_block_ends(
    town: &mut Town,
    first: usize,
    tract: &Geometry,
    block: f64,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
) -> io::Result<()> {
    let ends = unconnected_ends(town, first, spatial)?;
    if ends.len() < 2 {
        return Ok(());
    }
    let pairs = if ends.len() == 2 {
        vec![[0, 1]]
    } else {
        spatial
            .delaunay_edges(&ends.iter().map(|&(p, _, _)| pos(p)).collect::<Vec<_>>())
            .map_err(io::Error::other)?
    };
    let mut links = Vec::new();
    for [a, b] in pairs {
        let (p, ta, ia) = ends[a];
        let (q, tb, ib) = ends[b];
        let axis = unit(sub(q, p));
        let gap = distance(p, q);
        if ia == ib
            || gap < town.plot().0
            || gap > block * 2.
            || dot(ta, tb) < std::f64::consts::FRAC_1_SQRT_2
            || dot(axis, ta).abs() > std::f64::consts::FRAC_1_SQRT_2
            || dot(axis, tb).abs() > std::f64::consts::FRAC_1_SQRT_2
        {
            continue;
        }
        links.push((gap, a, b, axis));
    }
    // hpc-exempt: shortest back-street connections between physical block ends.
    links.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut sides = vec![[false; 2]; ends.len()];
    for (_, a, b, axis) in links {
        let (p, ta, _) = ends[a];
        let (q, tb, _) = ends[b];
        let sa = usize::from(dot(crate::town::geometry::left(ta), axis) > 0.);
        let sb = usize::from(dot(crate::town::geometry::left(tb), axis) < 0.);
        if !sides[a][sa]
            && !sides[b][sb]
            && spatial
                .relation(tract, &line(&[p, q]), crate::spatial::Predicate::Covers)
                .map_err(io::Error::other)?
            && lay(town, ground, spatial, &[p, q], Class::Lane)?
        {
            sides[a][sa] = true;
            sides[b][sb] = true;
        }
    }
    Ok(())
}

fn open_block_street(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    mut points: Vec<Point>,
    block_width: f64,
) -> io::Result<()> {
    if points.len() < 2 {
        return Ok(());
    }
    let network = StreetLines::near(town, &points, block_width, spatial)?;
    if network.is_empty() && !town.streets().is_empty() {
        return Ok(());
    }
    if !network.attach_walk(&mut points)? {
        // Join the nearer end. The connector must reach this
        // block before any of its interior streets can open.
        let mut connection = None;
        for end in [points[0], *points.last().unwrap()] {
            if let Some(p) = network.project(end)? {
                let gap = distance(p, end);
                if connection.is_none_or(|(best, _, _)| gap < best) {
                    connection = Some((gap, p, end));
                }
            }
        }
        let Some((gap, p, end)) = connection else {
            return Ok(());
        };
        if gap > block_width || !lay(town, ground, spatial, &[p, end], Class::Lane)? {
            return Ok(());
        }
    }
    lay(town, ground, spatial, &points, Class::Street)?;
    Ok(())
}

fn lay(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    points: &[Point],
    class: Class,
) -> io::Result<bool> {
    let form = town.street_form(class);
    let Some(mut road) = lane(points, form, ground, stops_lane, form.width()) else {
        return Ok(false);
    };
    if distance(*road.points.last().unwrap(), *points.last().unwrap()) > JUNCTION_TOLERANCE {
        return Ok(false);
    }
    // The survey samples terrain along each leg. Keep only the designed bends
    // in the stored street, as in the City's captured thoroughfares.
    road.points = points.to_vec();
    road.widths = vec![form.width(); points.len()];
    town.connect_route(road, 2., spatial)
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_map::regions::rectangle;

    #[test]
    fn a_close_road_across_a_notch_does_not_displace_frontage_in_the_tract() {
        use crate::town::{
            network::Street,
            seat::Seat,
            story::{Size, Story},
        };
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let origin = [10., 70.];
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("notched precinct"),
                name: "Precinct".into(),
                centre: origin,
                story: Story {
                    people: 1600.,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        );
        town.set_approaches(vec![
            Street::new(vec![[30., 65.], [30., 90.]], Class::Street, Size::Town),
            Street::new(vec![[0., 30.], [20., 30.]], Class::Street, Size::Town),
        ]);
        let area = Geometry::Polygon {
            coordinates: vec![[
                [0., 0.],
                [100., 0.],
                [100., 100.],
                [80., 100.],
                [80., 20.],
                [20., 20.],
                [20., 100.],
                [0., 100.],
                [0., 0.],
            ]
            .into_iter()
            .map(pos)
            .collect()],
        };
        let (served, road) = served_site(
            &town,
            &spatial,
            &area,
            origin,
            std::f64::consts::PI * 25_f64.powi(2),
        )
        .unwrap();
        assert_eq!(served, [10., 30.]);
        assert_eq!(road, Some((1, served)));

        // Another quarter subsequently opens a street beside this tract's
        // original seat. Its surveyed first row still starts on the chosen street.
        let mut streets = town.streets().to_vec();
        streets.push(Street::new(
            vec![[0., 70.], [20., 70.]],
            Class::Street,
            Size::Town,
        ));
        town.set_approaches(streets);
        town.district = Some(crate::town::fabric::DistrictSite {
            outline: rectangle(Bounds(-50., -50., 150., 150.)),
            streets: vec![],
            reserves: vec![],
            program: None,
            old_walls: None,
            density_per_km2: Some(1200.),
            tracts: vec![crate::town::fabric::DistrictTract {
                area,
                civic: false,
                mix: Default::default(),
                built_share: Some(0.2),
                developed_m2: 200.,
                density_per_km2: Some(1200.),
            }],
        });
        let ground = Ground::new([-50., -50., 150., 150.], 1.);
        crate::town::founding::occupy_district(
            &mut town,
            vec![Some(TractAccess {
                origin: served,
                streets: vec![1],
            })],
            &ground,
            &spatial,
            |_| Ok(Some(crate::town::influence::Conditions::default())),
        )
        .unwrap();
        assert_eq!(town.holdings().first().unwrap().slot.street, Some(1));
    }

    #[test]
    fn occupied_sub_block_tracts_without_a_city_avenue_share_a_public_way() {
        use crate::town::{
            fabric::{DistrictSite, DistrictTract},
            seat::Seat,
        };
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("outlying district"),
                name: "Outlying district".into(),
                centre: [100., 100.],
                story: Default::default(),
                arms: vec![],
                culture: None,
            },
            None,
        );
        let (front, depth) = town.plot();
        let developed = 4. * front * depth;
        town.district = Some(DistrictSite {
            outline: rectangle(Bounds(0., 0., 400., 200.)),
            reserves: vec![],
            streets: vec![],
            program: None,
            old_walls: None,
            density_per_km2: Some(700.),
            tracts: [100., 300.]
                .into_iter()
                .map(|x| DistrictTract {
                    area: rectangle(Bounds(x - 45., 50., x + 45., 150.)),
                    developed_m2: developed,
                    civic: false,
                    built_share: Some(0.1),
                    density_per_km2: Some(700.),
                    mix: Default::default(),
                })
                .collect(),
        });
        let ground = Ground::new([0., 0., 400., 200.], 1.);
        streets(&mut town, &ground, &spatial).unwrap();
        let first = &town.streets()[0];
        assert_eq!(first.class, Class::Main);
        let trunk = line(&first.points);
        assert!(town.streets()[1..].iter().any(|road| {
            let trace = line(&road.points);
            spatial
                .relation(&trace, &trunk, crate::spatial::Predicate::Intersects)
                .unwrap()
                && spatial.distance(&trace, &point(pos([300., 100.]))).unwrap() < front
        }));
    }

    #[test]
    fn a_boundary_avenue_develops_its_buildable_side() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let tract = rectangle(Bounds(0., 0., 300., 300.));
        let avenue = line(&[[0., 0.], [0., 300.]]);
        let land = occupied_land(&spatial, &tract, &avenue, 18_000., 8.).unwrap();
        let bounds = spatial.bounds(&land).unwrap();
        assert!(bounds.2 >= 60. && bounds.2 <= 68.);
        assert_eq!(bounds.0, 0.);
    }

    #[test]
    fn adjacent_built_tracts_share_avenue_frontage_and_blocks_at_their_boundary() {
        use crate::town::{
            fabric::{DistrictSite, DistrictTract},
            network::Street,
            seat::Seat,
            story::{Size, Story},
        };
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("river road"),
                name: "River road".into(),
                centre: [110., 100.],
                story: Story {
                    people: 2000.,
                    ..Default::default()
                },
                arms: vec![],
                culture: None,
            },
            None,
        );
        town.set_approaches(vec![Street::new(
            vec![[0., 100.], [840., 100.]],
            Class::Main,
            Size::Town,
        )]);
        town.district = Some(DistrictSite {
            outline: rectangle(Bounds(0., 0., 840., 200.)),
            streets: vec![(atlas_map::Id::from_name("avenue"), "Avenue".into())],
            reserves: vec![],
            program: None,
            old_walls: None,
            density_per_km2: Some(2000.),
            tracts: [0., 420.]
                .into_iter()
                .map(|x| DistrictTract {
                    area: rectangle(Bounds(x, 0., x + 420., 200.)),
                    civic: false,
                    mix: Default::default(),
                    built_share: Some(0.45),
                    density_per_km2: Some(2000.),
                    developed_m2: 37_800.,
                })
                .collect(),
        });
        let ground = Ground::new([0., 0., 840., 200.], 2.);
        let sites = streets(&mut town, &ground, &spatial).unwrap();
        let seam = point(pos([420., 138.]));
        assert!(town.streets()[1..]
            .iter()
            .any(|r| spatial.distance(&line(&r.points), &seam).unwrap() < 35.));
        crate::town::founding::occupy_district(&mut town, sites, &ground, &spatial, |_| {
            Ok(Some(crate::town::influence::Conditions::default()))
        })
        .unwrap();
        for (west, east) in [(370., 420.), (420., 470.)] {
            assert!(town
                .holdings()
                .iter()
                .any(|h| h.slot.street == Some(0) && (west..east).contains(&h.slot.front[0])));
        }
    }
    #[test]
    fn a_quarter_behind_a_wall_can_be_served_from_the_next_block() {
        use crate::town::{ground::WALL, network::Street, seat::Seat};
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let origin = [44., 30.];
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("wall-quarter"),
                name: "Quarter".into(),
                centre: origin,
                story: Default::default(),
                arms: vec![],
                culture: None,
            },
            None,
        );
        town.set_approaches(vec![Street::new(
            vec![[16., 24.], [16., 32.]],
            Class::Street,
            town.seat.story.size(),
        )]);
        let mut ground = Ground::new([0., 0., 80., 70.], 1.);
        for i in ground.cells_within([29., 0., 34., 38.]) {
            ground.withhold(i, WALL);
        }
        let path = enter_quarter(&mut town, &ground, &spatial, (0, [16., 30.]), origin, 36.)
            .unwrap()
            .unwrap();
        assert!(spatial.bounds(&path).unwrap().3 > 38.);
        assert!(
            spatial.distance(&path, &point(pos(origin))).unwrap()
                <= town.street_form(Class::Lane).width()
        );
        assert!(spatial
            .relation(
                &path,
                &line(&town.streets()[0].points),
                crate::spatial::Predicate::Intersects
            )
            .unwrap());
    }
}
