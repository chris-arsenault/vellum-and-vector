use super::{HoldingId, Kind, Point, Street, Town};
use crate::{spatial::SpatialKernel, town::edits::line};
use atlas_map::{spatial::Overlay, Geometry};
use std::io;
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
    /// Fit the added shoulders to the loaded portion of the existing carriageway.
    /// Width tapers back to the old profile at either end of the investment.
    pub fn widen(
        &mut self,
        load: crate::town::access::StreetLoad,
        ground: &mut crate::town::ground::Ground,
        spatial: &dyn SpatialKernel,
    ) -> io::Result<bool> {
        use crate::town::{
            geometry::{add, at, distance, left, scale, sub, unit},
            ground::{FIRST_STREET, PLOT},
            network::stops_lane,
        };
        let road = &self.streets[load.street];
        let span = load.end - load.start;
        if span < 3. {
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
        let extra = ((2.4 + load.value.sqrt()) - old).clamp(0., 1.);
        let expense = span * extra * 0.5;
        if extra < 0.2 || expense > self.access_effort {
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
            self.nearby_holdings(spatial.bounds(&area).map_err(io::Error::other)?, spatial)?;
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
            if holding.public || holding.claim > load.value {
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
        if self.streets[id].points.last() != tail.points.first()
            || !self.connect_route(tail, 2., spatial)?
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
        let trace = line(&street.points);
        let Some(corridor) = street.corridor(0., spatial).map_err(io::Error::other)? else {
            return Ok(false);
        };
        let bounds = spatial.bounds(&corridor).map_err(io::Error::other)?;
        let nearby = self.nearby_holdings(bounds, spatial)?;
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
            if holding.claim > priority {
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
        let mut joins = vec![street.points[0], *street.points.last().unwrap()];
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
        for &i in &road_ids {
            let road = &self.streets[i];
            if let Some(crossing) = spatial
                .overlay(&trace, &line(&road.points), Overlay::Intersection)
                .map_err(io::Error::other)?
            {
                if spatial.length(&crossing).map_err(io::Error::other)? > 0.001 {
                    return Ok(false);
                }
                joins.extend(points(crossing));
            }
        }
        let mut network = crate::town::lanes::Network {
            streets: road_ids
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
        for ((id, road), envelope) in road_ids.into_iter().zip(network.streets).zip(envelopes) {
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
    pub(super) fn repurpose(&mut self, id: HoldingId, kind: Kind) -> bool {
        let Some(holding) = self.holdings.get_mut(id.0 as usize) else {
            return false;
        };
        if holding.public || holding.occupation > 0.4 || holding.secondary.is_some() {
            return false;
        }
        holding.kind = kind;
        holding.ties.clear();
        holding.craft = None;
        holding.cause = "Existing premises adapted to a new use".into();
        true
    }
}
