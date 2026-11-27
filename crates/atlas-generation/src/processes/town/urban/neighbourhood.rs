//! Give each quarter the City records as inhabited its first site and its way in. The
//! development rounds open the streets and raise the premises that follow.
use super::geometry::{divide, pos, xy};
use crate::{
    spatial::{Overlay, SpatialKernel},
    town::{
        fabric::Town,
        founding::TractAccess,
        geometry::{angle, distance, sub, Point},
        ground::Ground,
        growth::line,
        network::{lane, stops_lane, Class},
        settings::JUNCTION_TOLERANCE,
    },
};
use atlas_map::{
    regions::{boundary_lines, point},
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
    for quarter in &quarters {
        origins[quarter.index] = Some(lay_quarter(town, ground, spatial, quarter, block_width)?);
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

/// The streets that give a quarter frontage: those crossing it, and a boundary avenue
/// beside its first site.
fn serving_streets(
    town: &Town,
    spatial: &dyn SpatialKernel,
    area: &Geometry,
    origin: Point,
    approach: Option<StreetEntry>,
) -> io::Result<Vec<usize>> {
    let mut serving = Vec::new();
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
        if section.is_some_and(|section| !boundary_lines(&section).is_empty()) {
            serving.push(id);
        }
    }
    Ok(serving)
}
/// Where a quarter's first households stand and the streets that reach them. A quarter the
/// City's avenues do not touch gets one way in from the nearest street. The development
/// rounds open every other street the quarter comes to need.
fn lay_quarter(
    town: &mut Town,
    ground: &Ground,
    spatial: &dyn SpatialKernel,
    quarter: &Quarter,
    block_width: f64,
) -> io::Result<TractAccess> {
    let area = &quarter.area;
    let developed = quarter.developed;
    let (front, depth) = town.plot();
    let (origin, approach) = served_site(town, spatial, area, quarter.origin, developed)?;
    let mut serving = serving_streets(town, spatial, area, origin, approach)?;
    let unserved = serving.is_empty();
    let needs_feeder = |&(street, p): &StreetEntry| {
        unserved
            && developed >= 2. * front * depth
            && distance(p, origin) > town.streets()[street].width() / 2. + front
    };
    if let Some(entry) = approach.filter(needs_feeder) {
        if let Some(link) = enter_quarter(town, ground, spatial, entry, origin, block_width)? {
            if spatial
                .clip_trace(&link, area)
                .map_err(io::Error::other)?
                .is_some()
            {
                serving.push(town.streets().len() - 1);
            }
        }
    }
    serving.sort_unstable();
    Ok(TractAccess {
        origin,
        streets: serving,
    })
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
    fn each_built_tract_on_an_avenue_starts_with_a_kernel_and_no_block_streets() {
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
        // The avenue serves both tracts; founding opens no street of its own.
        assert_eq!(town.streets().len(), 1);
        crate::town::founding::occupy_district(&mut town, sites, &ground, &spatial, |_| {
            Ok(Some(crate::town::influence::Conditions::default()))
        })
        .unwrap();
        // Each tract's first households front the avenue, and most of each tract is left
        // for the rounds: its developed ground has room for over a hundred premises.
        let (front, depth) = town.plot();
        let room = (37_800. / (front * depth)) as usize;
        for (west, east) in [(0., 420.), (420., 840.)] {
            let kernel = town
                .holdings()
                .iter()
                .filter(|h| (west..east).contains(&h.slot.front[0]))
                .count();
            assert!(kernel >= 1 && kernel < room / 4);
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
