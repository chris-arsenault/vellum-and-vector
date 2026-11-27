use super::{HoldingId, Kind, Point, Street, Town};
use crate::{spatial::SpatialKernel, town::edits::line};
use atlas_map::{spatial::Overlay, Geometry};
use std::io;
/// The shortest loaded stretch worth widening. Street metres, resolved by `Measure::Layout`.
const LEAST_WIDENED: f64 = 3.;
/// The most one widening adds to a way, and the least worth building. Street metres, resolved
/// by `Measure::Width`.
const WIDENING: f64 = 1.;
const LEAST_WIDENING: f64 = 0.2;
fn points(value: Geometry) -> Vec<Point> {
    match value {
        Geometry::Point { coordinates } => {
            let [x, y, _] = coordinates.coordinates();
            vec![[x, y]]
        }
        Geometry::MultiPoint { coordinates } => coordinates
            .into_iter()
            .map(|p| {
                let [x, y, _] = p.coordinates();
                [x, y]
            })
            .collect(),
        Geometry::GeometryCollection { geometries } => {
            geometries.into_iter().flat_map(points).collect()
        }
        _ => vec![],
    }
}
impl Town {
    /// A place without a captured highway can develop a high street of its own.
    /// Use actual journeys along occupied frontage to pick the local spine.
    /// Crossroads and widening subsequently invest in that street in place.
    pub(crate) fn recognise_high_street(&mut self) {
        use crate::town::{network::Class, story::Size};
        if self.seat.story.size() < Size::Town
            || self.streets.iter().any(|s| s.class == Class::Main)
        {
            return;
        }
        let depth = self.plot().1;
        let mut occupied = vec![(f64::INFINITY, f64::NEG_INFINITY, 0.); self.streets.len()];
        for holding in &self.holdings {
            if let Some(i) = holding.slot.street.filter(|_| holding.occupation > 0.) {
                let row = &mut occupied[i];
                row.0 = row.0.min(holding.slot.along);
                row.1 = row.1.max(holding.slot.along);
                row.2 += holding.occupation * holding.slot.frontage;
            }
        }
        let strongest = occupied
            .into_iter()
            .enumerate()
            .filter(|(i, (start, end, _))| end - start >= depth * 3. && self.wear[*i] > 0.)
            .max_by(|(a, (_, _, front_a)), (b, (_, _, front_b))| {
                (front_a * self.wear[*a]).total_cmp(&(front_b * self.wear[*b]))
            });
        if let Some((i, _)) = strongest {
            self.streets[i].class = Class::Main;
        }
    }
    /// Fit the added shoulders to the loaded portion of the existing carriageway.
    /// Width tapers back to the old profile at either end of the investment.
    pub fn widen(
        &mut self,
        load: crate::town::access::StreetLoad,
        ground: &mut crate::town::ground::Ground,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        if self
            .district
            .as_ref()
            .is_some_and(|d| load.street < d.streets.len())
        {
            return Ok(false);
        }
        use crate::town::{
            geometry::{add, at, distance, left, scale, sub, unit},
            ground::{FIRST_STREET, PLOT},
            network::stops_lane,
            scale::Measure,
            settings::FREIGHT_WIDTH,
        };
        let town_scale = self.scale();
        let road = &self.streets[load.street];
        let span = load.end - load.start;
        if span < town_scale.length(LEAST_WIDENED, Measure::Layout) {
            return Ok(false);
        }
        let mut measures = vec![0.];
        for pair in road.points.windows(2) {
            measures.push(measures.last().unwrap() + distance(pair[0], pair[1]));
        }
        let middle = (load.start + load.end) / 2.;
        let width_at = |s: f64| {
            let j = measures
                .partition_point(|m| *m < s)
                .clamp(1, measures.len() - 1);
            let t =
                ((s - measures[j - 1]) / (measures[j] - measures[j - 1]).max(0.001)).clamp(0., 1.);
            road.widths[j - 1] + (road.widths[j] - road.widths[j - 1]) * t
        };
        let old = width_at(middle);
        let width = |metres| town_scale.length(metres, Measure::Width);
        // The load asks for a way this many street metres wider than a cart's.
        let wanted = width(FREIGHT_WIDTH + load.value.sqrt());
        let extra = (wanted - old).clamp(0., width(WIDENING));
        let expense = span * extra * 0.5;
        if extra < width(LEAST_WIDENING) || expense > self.access_effort {
            return Ok(false);
        }
        let Some((start, _)) = at(&road.points, load.start) else {
            return Ok(false);
        };
        let Some((end, _)) = at(&road.points, load.end) else {
            return Ok(false);
        };
        let Some((mid, _)) = at(&road.points, middle) else {
            return Ok(false);
        };
        let normal = left(unit(sub(end, start)));
        if distance(start, end) + 0.01 < span {
            return Ok(false);
        }
        let mut shoulders = Vec::new();
        for sign in [-0.5, 0.5] {
            let edge = |p, w| add(p, scale(normal, sign * w));
            let a = edge(start, width_at(load.start));
            let b = edge(mid, old + extra);
            let c = edge(end, width_at(load.end));
            let d = edge(mid, old);
            for ring in [[a, b, d, a], [d, b, c, d]] {
                if ring[..3].iter().any(|p| stops_lane(ground.owner(*p))) {
                    return Ok(false);
                }
                shoulders.push(super::polygon(&ring));
            }
        }
        let area = Geometry::GeometryCollection {
            geometries: shoulders,
        };
        let nearby =
            self.surface_holdings(spatial.bounds(&area).map_err(io::Error::other)?, spatial)?;
        let roofs: Vec<_> = nearby
            .iter()
            .flat_map(|&i| self.holdings[i].buildings.iter().cloned())
            .collect();
        if spatial
            .intersection_areas(&area, &roofs)
            .map_err(io::Error::other)?
            .iter()
            .any(|a| *a > 0.0001)
        {
            return Ok(false);
        }
        let claims: Vec<_> = nearby
            .iter()
            .map(|&i| self.holdings[i].outline.clone())
            .collect();
        let overlaps = spatial
            .intersection_areas(&area, &claims)
            .map_err(io::Error::other)?;
        let mut revisions = Vec::new();
        for (i, _) in nearby
            .into_iter()
            .zip(overlaps)
            .filter(|(_, area)| *area > 0.0001)
        {
            let holding = &self.holdings[i];
            if holding.public || holding.land_claim() > load.value {
                return Ok(false);
            }
            let Some(shape) = spatial
                .overlay(&holding.outline, &area, Overlay::Difference)
                .map_err(io::Error::other)?
            else {
                return Ok(false);
            };
            if !matches!(shape, Geometry::Polygon { .. }) {
                return Ok(false);
            }
            revisions.push((i, shape));
        }
        let mut profile: Vec<_> = measures
            .iter()
            .copied()
            .zip(road.points.iter().copied())
            .collect();
        profile.extend([(load.start, start), (middle, mid), (load.end, end)]);
        profile.sort_by(|a, b| a.0.total_cmp(&b.0));
        profile.dedup_by(|a, b| (a.0 - b.0).abs() < 0.001);
        let (points, widths) = profile
            .into_iter()
            .map(|(s, p)| {
                let taper = (1. - (s - middle).abs() / (span * 0.5)).max(0.);
                (p, width_at(s) + extra * taper)
            })
            .unzip();
        let mut widened = road.clone();
        widened.points = points;
        widened.widths = widths;
        let envelope = (load.street < self.fitting.borrow().roads.len())
            .then(|| super::road_bounds(&widened, spatial))
            .transpose()?;
        let owner = FIRST_STREET + load.street as u32;
        ground.release_shape(&area, PLOT, spatial)?;
        ground.mark_shapes(&[area], owner, spatial)?;
        self.streets[load.street] = widened;
        if let Some(bounds) = envelope {
            self.fitting.get_mut().roads.replace(load.street, bounds);
        }
        for (i, shape) in revisions {
            self.holdings[i].outline = shape;
        }
        self.access_effort -= expense;
        Ok(true)
    }
    /// Lengthening an existing street preserves the measurements and entrances along its old course.
    pub fn extend_street(
        &mut self,
        id: usize,
        tail: Street,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        if self.district.as_ref().is_some_and(|d| id < d.streets.len())
            || self.streets[id].points.last() != tail.points.first()
            || !self.fit_route(tail, 2., Some(id), spatial)?
        {
            return Ok(false);
        }
        let extension = self.streets.pop().expect("accepted street");
        self.fitting.get_mut().roads = Default::default();
        self.wear.pop();
        let street = &mut self.streets[id];
        let offset = street.length();
        street.points.extend(extension.points.into_iter().skip(1));
        street.widths.extend(extension.widths.into_iter().skip(1));
        street.bridges.extend(
            extension
                .bridges
                .into_iter()
                .map(|(a, b)| (a + offset, b + offset)),
        );
        street.through_route = extension.through_route;
        Ok(true)
    }
    pub fn connect_route(
        &mut self,
        street: Street,
        priority: f64,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        self.fit_route(street, priority, None, spatial)
    }

    fn fit_route(
        &mut self,
        street: Street,
        priority: f64,
        extending: Option<usize>,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        let trace = line(&street.points);
        let Some(corridor) = street.corridor(0., spatial).map_err(io::Error::other)? else {
            return Ok(false);
        };
        let bounds = spatial.bounds(&corridor).map_err(io::Error::other)?;
        if let Some(district) = &self.district {
            if !self
                .district_mask(district, spatial)?
                .covers(&trace)
                .map_err(io::Error::other)?
                || spatial
                    .intersection_areas(
                        &corridor,
                        &self.nearby_reserves(district, bounds, spatial)?,
                    )
                    .map_err(io::Error::other)?
                    .iter()
                    .any(|area| *area > 0.0001)
            {
                return Ok(false);
            }
        }
        let nearby = self.surface_holdings(bounds, spatial)?;
        let buildings: Vec<_> = nearby
            .iter()
            .flat_map(|&i| self.holdings[i].buildings.iter().cloned())
            .collect();
        if spatial
            .intersection_areas(&corridor, &buildings)
            .map_err(io::Error::other)?
            .iter()
            .any(|a| *a > 0.0001)
        {
            return Ok(false);
        }
        let mut changed = Vec::new();
        for i in nearby {
            let holding = &self.holdings[i];
            if holding.public {
                continue;
            }
            let overlap = spatial
                .intersection_areas(&corridor, std::slice::from_ref(&holding.outline))
                .map_err(io::Error::other)?[0];
            if overlap <= 0.0001 {
                continue;
            }
            if holding.land_claim() > priority {
                return Ok(false);
            }
            let Some(outline) = spatial
                .overlay(&holding.outline, &corridor, Overlay::Difference)
                .map_err(io::Error::other)?
                .and_then(atlas_map::regions::polygon)
            else {
                return Ok(false);
            };
            changed.push((i, outline));
        }
        let tol = crate::town::settings::JUNCTION_TOLERANCE;
        let road_ids = self.nearby_roads(
            atlas_map::Bounds(
                bounds.0 - tol,
                bounds.1 - tol,
                bounds.2 + tol,
                bounds.3 + tol,
            ),
            spatial,
        )?;
        let Some(mut joins) =
            self.carriageway_junctions(&street, extending, bounds, &road_ids, spatial)?
        else {
            return Ok(false);
        };
        joins.extend([street.points[0], *street.points.last().unwrap()]);
        // Crossings with captured avenues still node the new street. Those avenues
        // keep their surveyed vertices, so only local roads need to be staged.
        let inherited = self.district.as_ref().map_or(0, |d| d.streets.len());
        let local_ids: Vec<_> = road_ids.into_iter().filter(|&id| id >= inherited).collect();
        let mut network = crate::town::lanes::Network {
            streets: local_ids
                .iter()
                .map(|&id| self.streets[id].clone())
                .collect(),
        };
        network.streets.push(street);
        for join in joins {
            crate::town::growth::connect(join, &mut network, spatial)?;
        }
        let new_road = network.streets.pop().expect("new road is staged last");
        let envelopes = network
            .streets
            .iter()
            .map(|road| super::road_bounds(road, spatial))
            .collect::<io::Result<Vec<_>>>()?;
        for ((id, road), envelope) in local_ids.into_iter().zip(network.streets).zip(envelopes) {
            self.fitting.get_mut().roads.replace(id, envelope);
            self.streets[id] = road;
        }
        self.streets.push(new_road);
        self.wear.resize(self.streets.len(), 0.);
        for (i, outline) in changed {
            self.holdings[i].outline = outline;
        }
        Ok(true)
    }

    fn carriageway_junctions(
        &self,
        street: &Street,
        extending: Option<usize>,
        bounds: atlas_map::Bounds,
        road_ids: &[usize],
        spatial: &dyn SpatialKernel,
    ) -> io::Result<Option<Vec<Point>>> {
        let trace = line(&street.points);
        let tol = crate::town::settings::JUNCTION_TOLERANCE;
        let mut joins = Vec::new();
        let mut paving = Vec::new();
        for &i in road_ids {
            let road = &self.streets[i];
            let axis = line(&road.points);
            if let Some(crossing) = spatial
                .overlay(&trace, &axis, Overlay::Intersection)
                .map_err(io::Error::other)?
            {
                if spatial.length(&crossing).map_err(io::Error::other)? > 0.001 {
                    return Ok(None);
                }
                joins.extend(points(crossing));
            } else {
                let distance = spatial.distance(&trace, &axis).map_err(io::Error::other)?;
                if distance > road.width() / 2. + tol {
                    continue;
                }
                if distance <= tol {
                    let [at, _] = spatial
                        .nearest_points(&trace, &axis)
                        .map_err(io::Error::other)?;
                    let [x, y, _] = at.coordinates();
                    joins.push([x, y]);
                }
            }
            if extending != Some(i) {
                if let Some(roadway) = self.road_corridor(i, spatial)? {
                    if let Some(local) = spatial
                        .clip_by_rect(&roadway, bounds)
                        .map_err(io::Error::other)?
                    {
                        paving.push(local);
                    }
                }
            }
        }
        if !opens_street(street, &trace, paving, &joins, self.plot().1, spatial)? {
            return Ok(None);
        }
        Ok(Some(joins))
    }
    pub(super) fn repurpose(&mut self, id: HoldingId, kind: Kind) -> bool {
        let Some(holding) = self.holdings.get_mut(id.0 as usize) else {
            return false;
        };
        if holding.public || holding.occupation > 0.4 || holding.secondary.is_some() {
            return false;
        }
        holding.kind = kind;
        holding.operation_tier = 1;
        holding.ties.clear();
        holding.craft = None;
        holding.cause = "Existing premises adapted to a new use".into();
        true
    }
}

/// Count the existing carriageways at a junction as one paved area. A crossing
/// or a connection between street axes can span a wide intersection. A dead end
/// mostly on existing pavement needs enough new ground to reach past a plot.
fn opens_street(
    street: &Street,
    trace: &Geometry,
    mut paving: Vec<Geometry>,
    joins: &[Point],
    plot_depth: f64,
    spatial: &dyn SpatialKernel,
) -> io::Result<bool> {
    use crate::town::{geometry::distance, settings::JUNCTION_TOLERANCE as TOL};
    use atlas_map::Position;
    let paved = if paving.len() > 1 {
        spatial.union_all(&paving).map_err(io::Error::other)?
    } else {
        paving.pop()
    };
    let Some(paved) = paved else { return Ok(true) };
    let Some(inside) = spatial
        .overlay(trace, &paved, Overlay::Intersection)
        .map_err(io::Error::other)?
    else {
        return Ok(true);
    };
    let used = spatial.length(&inside).map_err(io::Error::other)?;
    if used <= TOL {
        return Ok(true);
    }
    let fresh = street.length() - used;
    if fresh <= TOL || joins.is_empty() {
        return Ok(false);
    }
    let contacts = Geometry::MultiPoint {
        coordinates: joins.iter().map(|&[x, y]| Position::xy(x, y)).collect(),
    };
    for part in crate::features::network_parts::line_parts(&inside) {
        let run = Geometry::LineString {
            coordinates: part.to_vec(),
        };
        if spatial
            .distance(&run, &contacts)
            .map_err(io::Error::other)?
            > TOL
        {
            return Ok(false);
        }
    }
    if fresh >= used || fresh >= plot_depth {
        return Ok(true);
    }
    let ends = [street.points[0], *street.points.last().unwrap()];
    if ends
        .iter()
        .all(|p| joins.iter().any(|q| distance(*p, *q) <= TOL))
    {
        return Ok(true);
    }
    let covered = spatial
        .covers_points(&paved, &ends.map(|[x, y]| Position::xy(x, y)))
        .map_err(io::Error::other)?;
    Ok(!covered.into_iter().any(|inside| inside))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::{
        fabric::DistrictSite,
        network::Class,
        seat::Seat,
        story::{Size, Story},
    };
    use atlas_map::Id;

    fn assert_avenue_entries(mut connect: impl FnMut(Vec<Point>) -> bool) {
        assert!(!connect(vec![[-120., 0.], [-3., 11.]]));
        assert!(!connect(vec![[-100., 10.], [-50., 10.], [-40., 17.]]));
        assert!(!connect(vec![[-35., 0.], [-35., 19.]]));
        assert!(connect(vec![[2., -17.], [2., 17.]]));
        assert!(connect(vec![[25., 0.], [25., 52.]]));
        assert!(connect(vec![[60., -40.], [80., -40.]]));
    }

    #[test]
    fn streets_use_new_ground_and_join_through_real_carriageways() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let mut town = Town::new(
            Seat {
                key: Id::from_name("junction"),
                name: "Junction".into(),
                centre: [0., 0.],
                story: Story {
                    people: 3000.,
                    ..Default::default()
                },
                arms: Vec::new(),
                culture: None,
            },
            None,
        );
        let mut avenue = Street::new(vec![[-150., 0.], [150., 0.]], Class::Main, Size::Town);
        avenue.widths.fill(28.);
        let original = avenue.points.clone();
        town.set_approaches(vec![avenue]);
        town.district = Some(DistrictSite {
            outline: super::super::polygon(&[
                [-200., -100.],
                [200., -100.],
                [200., 100.],
                [-200., 100.],
                [-200., -100.],
            ]),
            reserves: vec![],
            streets: vec![(Id::from_name("avenue"), "Avenue".into())],
            program: None,
            tracts: vec![],
            density_per_km2: None,
            old_walls: None,
        });
        assert_avenue_entries(|points| {
            town.connect_route(Street::new(points, Class::Lane, Size::Town), 2., &spatial)
                .unwrap()
        });
        assert_eq!(town.streets()[0].points, original);
        assert_eq!(town.district.as_ref().unwrap().streets[0].1, "Avenue");
        assert!(town.streets()[1].points.contains(&[2., 0.]));
        let continuation = Street::new(vec![[80., -40.], [81., -40.]], Class::Lane, Size::Town);
        assert!(town.extend_street(3, continuation, &spatial).unwrap());
    }
}
