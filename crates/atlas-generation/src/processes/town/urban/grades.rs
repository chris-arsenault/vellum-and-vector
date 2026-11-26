//! Locate road works on the longitudinal profile of the selected alignment.
use super::{
    geometry::{line, xy},
    Element,
};
use crate::town::geometry::{distance, resample, Point};
use atlas_map::{Geometry, Position};
use serde_json::{json, Value};

pub(super) const DESIGN_GRADE: f64 = 0.08;
pub(super) const SURVEY_STEP: f64 = 40.;
/// Extra deck length competes with the depth of the descent it saves.
const SPAN_COST: f64 = 0.065;

pub(super) struct Survey<'a> {
    pub elevation: &'a dyn Fn(Point) -> f64,
    pub open: &'a dyn Fn(Point) -> bool,
}

pub(super) fn terrain<'a>(
    mesh: &'a crate::lattice::TriangularLattice,
    heights: &'a [f64],
) -> impl Fn(Point) -> f64 + 'a {
    let [ox, oy] = mesh.origin();
    let sampler = std::cell::RefCell::new(crate::lattice::sampling::Sampler::new(mesh));
    move |[x, y]| {
        sampler
            .borrow_mut()
            .sample([x - ox, y - oy], |i| Ok(heights[i]))
            .expect("in-memory terrain profile")
    }
}

pub(super) struct Connection {
    pub built: Vec<Element>,
    pub shared_ground: Vec<Vec<Point>>,
}

impl Connection {
    fn follow(&mut self, shared: super::avenues::SharedWay, survey: &Survey<'_>, width: f64) {
        self.shared_ground.extend(shared.ground);
        for feeder in shared.approaches {
            if crate::town::geometry::line_length(&feeder) > 0.01 {
                self.built.push(survey.road(line(&feeder), "Avenue", width));
            }
        }
    }
}

impl Survey<'_> {
    pub(super) fn connections(
        &self,
        spatial: &dyn crate::spatial::SpatialKernel,
        mut course: Geometry,
        width: f64,
        existing: &[Element],
        earthwork: &dyn Fn(Point, Point) -> f64,
    ) -> std::io::Result<Connection> {
        let mut result = Connection {
            built: Vec::new(),
            shared_ground: Vec::new(),
        };
        let Geometry::LineString { coordinates } = &mut course else {
            result.built.push(self.road(course, "Avenue", width));
            return Ok(result);
        };
        if existing.is_empty() || coordinates.len() < 2 {
            result.built.push(self.road(course, "Avenue", width));
            return Ok(result);
        }
        let avenues = super::avenues::Avenues::new(spatial, existing)?;
        let last = coordinates.len() - 1;
        let original = [coordinates[0], coordinates[last]];
        for i in [0, last] {
            coordinates[i] = avenues.attachment(spatial, coordinates[i])?;
        }
        let ends = [xy(coordinates[0]), xy(coordinates[last])];
        if original[0] != original[1] && distance(ends[0], ends[1]) < 1e-6 {
            result.shared_ground.push(vec![ends[0]]);
            return Ok(result);
        }
        if let Some(shared) = avenues.share(spatial, self, ends, earthwork)? {
            result.follow(shared, self, width);
            return Ok(result);
        }

        // A long alignment can use a retained hillside passage on just one climb.
        let points = resample(
            &coordinates.iter().copied().map(xy).collect::<Vec<_>>(),
            SURVEY_STEP,
        );
        let z = self.profile(&points);
        let mut leg = Vec::new();
        let mut i = 0;
        let mut reused = false;
        while i < points.len() {
            leg.push(points[i]);
            if i + 1 == points.len() {
                break;
            }
            let rise = z[i + 1] - z[i];
            if rise.abs() > DESIGN_GRADE * distance(points[i], points[i + 1]) {
                let end = climb_end(&points, &z, i, rise.signum());
                if (z[end] - z[i]).abs() > 6. {
                    let shared = if i == 0 && end + 1 == points.len() {
                        None
                    } else {
                        avenues.share(spatial, self, [points[i], points[end]], earthwork)?
                    };
                    if let Some(shared) = shared {
                        let [entry, mut exit] = shared.approaches;
                        leg.extend_from_slice(&entry[1..]);
                        if crate::town::geometry::line_length(&leg) > 0.01 {
                            result.built.push(self.road(line(&leg), "Avenue", width));
                        }
                        result.shared_ground.extend(shared.ground);
                        exit.pop();
                        leg = exit;
                        reused = true;
                        i = end;
                        continue;
                    }
                    leg.extend_from_slice(&points[i + 1..end]);
                    i = end;
                    continue;
                }
            }
            i += 1;
        }
        if !reused {
            result.built.push(self.road(course, "Avenue", width));
        } else if crate::town::geometry::line_length(&leg) > 0.01 {
            result.built.push(self.road(line(&leg), "Avenue", width));
        }
        Ok(result)
    }
    fn profile(&self, points: &[Point]) -> Vec<f64> {
        points.iter().map(|&p| (self.elevation)(p)).collect()
    }

    // A deck needs two bearing banks with open air beneath it. Cost per metre of
    // deck favours a short crossing and rules out spanning a whole broad valley.
    fn bridge(&self, banks: &[Point], heights: &[f64], floor: f64) -> Option<(usize, Value)> {
        let a = banks[0];
        let mut best = None;
        let mut merit = 0.;
        let mut lowest = heights[0];
        let mut walked = 0.;
        for j in 1..banks.len() {
            walked += distance(banks[j - 1], banks[j]);
            if heights[0] - floor - SPAN_COST * walked <= merit {
                break;
            }
            lowest = lowest.min(heights[j]);
            let b = banks[j];
            let span = distance(a, b);
            let rise = heights[j] - heights[0];
            if heights[j].min(heights[0]) - lowest < 8.
                || span < 2. * SURVEY_STEP
                || rise.abs() > DESIGN_GRADE * span
            {
                continue;
            }
            let deck = resample(&[a, b], SURVEY_STEP * 0.5);
            let mut clearance = 0.0_f64;
            let mut penetrating = false;
            for (i, &p) in deck.iter().enumerate().skip(1).take(deck.len() - 2) {
                let air =
                    heights[0] + rise * i as f64 / (deck.len() - 1) as f64 - (self.elevation)(p);
                if air < -0.5 {
                    penetrating = true;
                    break;
                }
                clearance = clearance.max(air);
            }
            let descent_saved = clearance.min(heights[0].min(heights[j]) - lowest);
            let score = descent_saved - SPAN_COST * walked - rise.abs() * 0.4;
            if !penetrating && clearance >= 8. && score > merit {
                best = Some((
                    j,
                    json!({"kind":"bridge","start":a,"end":b,
                    "deckStartMetres":heights[0],"deckEndMetres":heights[j],"clearanceMetres":clearance}),
                ));
                merit = score;
            }
        }
        best
    }

    #[cfg(test)]
    fn worst(&self, points: &[Point]) -> f64 {
        let walk = resample(points, SURVEY_STEP);
        if !walk.iter().all(|&p| (self.open)(p)) {
            return f64::INFINITY;
        }
        steepest(&walk, &self.profile(&walk))
    }

    // owner-direction(2026-11-25): keep the ravines and address road grade with switchbacks and bridges.
    pub fn road(&self, geometry: Geometry, class: &str, width: f64) -> Element {
        let Geometry::LineString { coordinates } = &geometry else {
            return Element::way(geometry, "thoroughfare", class, width);
        };
        let points = resample(
            &coordinates.iter().copied().map(xy).collect::<Vec<_>>(),
            SURVEY_STEP,
        );
        let z = self.profile(&points);
        let floor = z.iter().copied().fold(f64::INFINITY, f64::min);
        let mut course = Vec::new();
        let mut works = Vec::new();
        let mut i = 0;
        while i < points.len() {
            course.push(points[i]);
            if i + 1 == points.len() {
                break;
            }
            let grade = (z[i + 1] - z[i]) / distance(points[i], points[i + 1]);
            if grade < -DESIGN_GRADE {
                if let Some((span, mut bridge)) = self.bridge(&points[i..], &z[i..], floor) {
                    bridge["segment"] = (course.len() - 1).into();
                    works.push(bridge);
                    i += span;
                    continue;
                }
            }
            if grade.abs() > DESIGN_GRADE {
                let end = climb_end(&points, &z, i, grade.signum());
                if (z[end] - z[i]).abs() > 6. {
                    if let Some(path) =
                        super::hillside::traverse(self, &points[i..=end], &z[i..=end])
                    {
                        course.extend_from_slice(&path[1..path.len() - 1]);
                        works.push(json!({"kind":"switchback","course":path}));
                    } else {
                        course.extend_from_slice(&points[i + 1..end]);
                    }
                    i = end;
                    continue;
                }
            }
            i += 1;
        }
        if works.is_empty() {
            return Element::way(geometry, "thoroughfare", class, width);
        }
        let mut road = Element::way(line(&course), "thoroughfare", class, width);
        road.attributes
            .insert("roadFeatures".into(), Value::Array(works));
        road
    }
}

fn climb_end(points: &[Point], heights: &[f64], start: usize, direction: f64) -> usize {
    let mut high = start + 1;
    let mut shoulder = 0.;
    for i in high + 1..points.len() {
        shoulder += distance(points[i - 1], points[i]);
        let gain = direction * (heights[i] - heights[high]);
        if gain > shoulder * 0.025 {
            high = i;
            shoulder = 0.;
        }
        if gain < -2. || shoulder > 3. * SURVEY_STEP {
            break;
        }
    }
    high
}

/// A road joins a bridge at its abutments. Under the deck, the ravine floor
/// remains available to other routes and does not acquire street frontage.
pub(super) fn ground_parts(road: &Element) -> Vec<Geometry> {
    let bridges = road
        .attributes
        .get("roadFeatures")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|work| work.get("segment")?.as_u64());
    let Geometry::LineString { coordinates } = &road.geometry else {
        return vec![road.geometry.clone()];
    };
    let part = |p: &[Position]| {
        if p.len() == 1 {
            Geometry::Point { coordinates: p[0] }
        } else {
            Geometry::LineString {
                coordinates: p.to_vec(),
            }
        }
    };
    let mut start = 0;
    let mut ground = Vec::new();
    for segment in bridges {
        let end = segment as usize;
        ground.push(part(&coordinates[start..=end]));
        start = end + 1;
    }
    ground.push(part(&coordinates[start..]));
    ground
}

pub(super) fn ground_cells(mesh: &crate::lattice::TriangularLattice, road: &Element) -> Vec<usize> {
    use crate::field::refinement::courses::cell_at;
    let mut cells = Vec::new();
    for part in ground_parts(road) {
        let stations = match part {
            Geometry::Point { coordinates } => vec![xy(coordinates)],
            Geometry::LineString { coordinates } => resample(
                &coordinates.into_iter().map(xy).collect::<Vec<_>>(),
                mesh.spacing() / 4.,
            ),
            _ => continue,
        };
        cells.extend(stations.into_iter().filter_map(|p| cell_at(mesh, p)));
    }
    // Retain re-entry into an earlier triangle on the return leg of a hairpin.
    cells.dedup();
    cells
}

pub(super) fn bridge_links(
    roads: &[Element],
    mesh: &crate::lattice::TriangularLattice,
) -> Vec<crate::links::Link> {
    use crate::{field::refinement::courses::cell_at, links::Link};
    let mut links = Vec::new();
    for road in roads {
        let Geometry::LineString { coordinates } = &road.geometry else {
            continue;
        };
        for work in road
            .attributes
            .get("roadFeatures")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(i) = work.get("segment").and_then(Value::as_u64) else {
                continue;
            };
            let [p, q] = [xy(coordinates[i as usize]), xy(coordinates[i as usize + 1])];
            if let (Some(a), Some(b)) = (cell_at(mesh, p), cell_at(mesh, q)) {
                if a != b
                    && !links
                        .iter()
                        .any(|l: &Link| (l.a, l.b) == (a, b) || (l.b, l.a) == (a, b))
                {
                    links.push(Link {
                        a,
                        b,
                        cost: 0.5 * distance(p, q),
                    });
                }
            }
        }
    }
    links
}

#[cfg(test)]
fn steepest(p: &[Point], z: &[f64]) -> f64 {
    p.windows(2)
        .zip(z.windows(2))
        .map(|(p, z)| (z[1] - z[0]).abs() / distance(p[0], p[1]))
        .fold(0., f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn stops_within_the_width_use_the_avenue_and_keep_its_actual_junction() {
        let geos = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let survey = Survey {
            elevation: &|_| 0.,
            open: &|_| true,
        };
        let mut street = survey.road(line(&[[0., 0.], [0., 100.]]), "Avenue", 16.);
        let retained = std::slice::from_ref(&street);
        let route = survey
            .connections(
                &geos,
                line(&[[7.7, 20.], [0.2, 40.]]),
                16.,
                retained,
                &distance,
            )
            .unwrap();
        assert!(route.built.is_empty());
        for station in [[0., 20.], [0., 40.]] {
            assert!(route
                .shared_ground
                .iter()
                .flatten()
                .any(|&p| distance(p, station) < 1e-6));
        }
        let outside = survey
            .connections(
                &geos,
                line(&[[8.1, 20.], [0.2, 70.]]),
                16.,
                retained,
                &distance,
            )
            .unwrap();
        assert_eq!(outside.built.len(), 1);
        street.attributes.insert("widths".into(), json!([4., 20.]));
        let avenues =
            super::super::avenues::Avenues::new(&geos, std::slice::from_ref(&street)).unwrap();
        for (site, want) in [([7., 10.], [7., 10.]), ([7., 90.], [0., 90.])] {
            let station = avenues
                .attachment(&geos, super::super::geometry::pos(site))
                .unwrap();
            assert!(distance(xy(station), want) < 1e-6);
        }
    }
    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn two_journeys_share_connected_avenues_on_level_ground() {
        let geos = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let flat = Survey {
            elevation: &|_| 10.,
            open: &|_| true,
        };
        let retained = [
            flat.road(line(&[[0., 0.], [0., 400.]]), "Avenue", 16.),
            flat.road(line(&[[0., 300.], [240., 300.]]), "Avenue", 16.),
        ];
        let ends = [[12., 30.], [180., 310.]];
        let journey = flat
            .connections(&geos, line(&ends), 16., &retained, &distance)
            .unwrap();
        assert_eq!(journey.built.len(), 2);
        let new_length: f64 = journey
            .built
            .iter()
            .map(|r| crate::spatial::SpatialKernel::length(&geos, &r.geometry).unwrap())
            .sum();
        assert!(new_length < 25.);
        let shared: f64 = journey
            .shared_ground
            .iter()
            .map(|p| crate::town::geometry::line_length(p))
            .sum();
        assert!(shared > 440.);
        let blocked = Survey {
            elevation: &|_| 10.,
            open: &|p| p[0] < 4. || p[0] > 16.,
        };
        let distinct = blocked
            .connections(
                &geos,
                line(&[[18., 20.], [18., 260.]]),
                16.,
                &retained[..1],
                &distance,
            )
            .unwrap();
        assert!(distinct.shared_ground.is_empty());
        assert_eq!(distinct.built.len(), 1);
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn nearby_journey_reuses_the_hillside_and_builds_only_the_feeders() {
        let s = Survey {
            elevation: &|p| 0.24 * p[0],
            open: &|_| true,
        };
        let first = s.road(line(&[[0., 0.], [400., 0.]]), "Avenue", 10.);
        // Approach from outside the bend so both endpoints actually need feeders.
        let Geometry::LineString { coordinates } = &first.geometry else {
            panic!()
        };
        let approach_y = -12. * xy(coordinates[1])[1].signum();
        let shared = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let pieces = s
            .connections(
                &shared,
                line(&[[0., approach_y], [400., approach_y]]),
                10.,
                &[first],
                &distance,
            )
            .unwrap();
        assert!(!pieces.shared_ground.is_empty());
        assert_eq!(pieces.built.len(), 2);
        for p in pieces.built {
            assert!(!p.attributes.contains_key("roadFeatures"));
            assert!(crate::spatial::SpatialKernel::length(&shared, &p.geometry).unwrap() < 30.);
        }
    }
    #[test]
    fn a_survey_follows_the_profile_at_atlas_coordinates() {
        let mesh = crate::lattice::WorldLatticeOptions::default()
            .build(
                atlas_map::Bounds(80_000., 410_000., 84_000., 413_000.),
                5000.,
                0.,
                |_, _| true,
            )
            .unwrap();
        let heights: Vec<_> = (0..mesh.len())
            .map(|i| 300. + mesh.position(i)[0] * 0.15)
            .collect();
        let survey = terrain(&mesh, &heights);
        for (p, z) in [([81_500., 411_500.], 225.), ([82_500., 411_500.], 375.)] {
            assert!((survey(p) - z).abs() < 1.);
        }
    }
    #[test]
    fn a_traverse_adds_run_on_a_hillside_and_a_deck_spans_a_cut() {
        let axis = line(&[[0., 0.], [400., 0.]]);
        let slope = Survey {
            elevation: &|p| 0.25 * p[0],
            open: &|_| true,
        };
        let road = slope.road(axis.clone(), "Avenue", 10.);
        assert_eq!(road.attributes["roadFeatures"][0]["kind"], "switchback");
        let Geometry::LineString { coordinates } = road.geometry else {
            panic!()
        };
        let traverse: Vec<_> = coordinates.into_iter().map(xy).collect();
        assert!(slope.worst(&traverse) < 0.10);
        let cut = Survey {
            elevation: &|p| ((p[0] - 200.).abs() - 100.).min(0.) * 0.4,
            open: &|_| true,
        };
        let bridge = cut.road(axis.clone(), "Approach", 16.);
        let span = &bridge.attributes["roadFeatures"][0];
        assert_eq!(span["kind"], "bridge");
        assert_eq!(ground_parts(&bridge).len(), 2);
        assert!(span["clearanceMetres"].as_f64().unwrap() > 30.);
        let flat = Survey {
            elevation: &|_| 10.,
            open: &|_| true,
        };
        assert_eq!(flat.road(axis.clone(), "Avenue", 10.).geometry, axis);
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn a_shared_bridge_accepts_traffic_at_its_banks() {
        let spatial = atlas_gis::geometry::NativeGeos::new(1e-6).unwrap();
        let ends = [[-100., 0.], [100., 0.]];
        let mut bridge = Element::way(line(&ends), "thoroughfare", "Avenue", 16.);
        bridge.attributes.insert(
            "roadFeatures".into(),
            json!([{"kind":"bridge","segment":0}]),
        );
        let survey = Survey {
            elevation: &|_| 0.,
            open: &|p| p[0].abs() >= 99.,
        };
        let route = survey
            .connections(
                &spatial,
                line(&ends),
                16.,
                std::slice::from_ref(&bridge),
                &distance,
            )
            .unwrap();
        assert!(route.built.is_empty());
        assert!(ends
            .iter()
            .all(|p| route.shared_ground.iter().flatten().any(|q| q == p)));
        assert!(route.shared_ground.iter().all(|part| part.len() == 1));
        let under = survey
            .connections(
                &spatial,
                line(&[[0., -5.], [0., 5.]]),
                16.,
                &[bridge],
                &distance,
            )
            .unwrap();
        assert!(under.shared_ground.is_empty());
    }
}
