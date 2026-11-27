//! Junction insertion and local constraints for a proposed street.
use super::{
    geometry::{add, distance, scale, sub, Point},
    lanes::Network,
    settings::{JOIN_SHARE, JUNCTION_TOLERANCE, MIN_CONNECTION_SHARE, STREET_CLEARANCE_SHARE},
};
use crate::spatial::SpatialKernel;
use atlas_map::{
    spatial::{Overlay, SpatialIndex},
    Bounds, Geometry, Position,
};
use std::io;
pub fn line(points: &[Point]) -> Geometry {
    Geometry::LineString {
        coordinates: points.iter().map(|p| Position::xy(p[0], p[1])).collect(),
    }
}
fn point(p: Point) -> Geometry {
    Geometry::Point {
        coordinates: Position::xy(p[0], p[1]),
    }
}
fn xy(p: Position) -> Point {
    let [x, y, _] = p.coordinates();
    [x, y]
}

/// Put the same vertex in every street meeting here, including departures halfway along
/// a segment. Independently rounding a projected endpoint can otherwise open a tiny gap.
pub fn connect(at: Point, network: &mut Network, spatial: &dyn SpatialKernel) -> io::Result<()> {
    junction(at, network, spatial).map_err(io::Error::other)
}
fn junction(at: Point, network: &mut Network, spatial: &dyn SpatialKernel) -> Result<(), String> {
    let geometries: Vec<_> = network.streets.iter().map(|s| line(&s.points)).collect();
    let index = spatial.index(&geometries)?;
    for i in index.query(Bounds(
        at[0] - JUNCTION_TOLERANCE,
        at[1] - JUNCTION_TOLERANCE,
        at[0] + JUNCTION_TOLERANCE,
        at[1] + JUNCTION_TOLERANCE,
    ))? {
        if spatial.distance(&point(at), &geometries[i])? > JUNCTION_TOLERANCE {
            continue;
        }
        let street = &mut network.streets[i];
        // GEOS returns the map-precision crossing. Reuse a coincident vertex
        // instead of inserting a sub-precision leg beside its unrounded position.
        if let Some(vertex) = street
            .points
            .iter_mut()
            .find(|p| distance(**p, at) <= JUNCTION_TOLERANCE)
        {
            *vertex = at;
            continue;
        }
        let fraction = spatial.line_fraction(&geometries[i], Position::xy(at[0], at[1]))?;
        let vertices: Vec<_> = street
            .points
            .iter()
            .map(|p| Position::xy(p[0], p[1]))
            .collect();
        let fractions = spatial.line_fractions(&geometries[i], &vertices)?;
        if fraction <= 0.0 {
            street.points[0] = at;
        } else if fraction >= 1.0 {
            *street.points.last_mut().unwrap() = at;
        } else {
            let after = fractions.partition_point(|&f| f < fraction);
            let before = after.saturating_sub(1);
            let t = (fraction - fractions[before]) / (fractions[after] - fractions[before]);
            let width = street.widths[before] + t * (street.widths[after] - street.widths[before]);
            street.points.insert(after, at);
            street.widths.insert(after, width);
        }
    }
    Ok(())
}
fn positions(shape: &Geometry, found: &mut Vec<Point>) {
    match shape {
        Geometry::Point { coordinates } => found.push(xy(*coordinates)),
        Geometry::MultiPoint { coordinates } | Geometry::LineString { coordinates } => {
            found.extend(coordinates.iter().map(|p| xy(*p)));
        }
        Geometry::MultiLineString { coordinates } => {
            found.extend(coordinates.iter().flatten().map(|p| xy(*p)));
        }
        Geometry::GeometryCollection { geometries } => {
            for shape in geometries {
                positions(shape, found);
            }
        }
        _ => {}
    }
}

/// Prune at the first crossing; otherwise snap the endpoint to a nearby street. Reject
/// overlapping departures and very small blocks rather than adding nearly parallel roads.
pub fn constrain(
    proposal: &[Point; 2],
    network: &Network,
    spacing: f64,
    spatial: &dyn SpatialKernel,
) -> io::Result<Option<(Point, bool)>> {
    StreetLines::new(&network.streets, spatial)?.constrain(proposal, spacing)
}
/// One indexed snapshot of the current centrelines for projection and intersection.
pub(crate) struct StreetLines<'a> {
    lines: Vec<Geometry>,
    index: Box<dyn SpatialIndex + 'a>,
    spatial: &'a dyn SpatialKernel,
}
impl<'a> StreetLines<'a> {
    /// Only a road in this envelope can intersect the proposal or receive a snapped end.
    pub(crate) fn near(
        town: &super::fabric::Town,
        course: &[Point],
        reach: f64,
        spatial: &'a dyn SpatialKernel,
    ) -> io::Result<Self> {
        // A departure snapped onto its own destination still has a search
        // envelope, even though its two positions no longer form a line.
        let positions = Geometry::MultiPoint {
            coordinates: course.iter().map(|p| Position::xy(p[0], p[1])).collect(),
        };
        let Bounds(w, s, e, n) = spatial.bounds(&positions).map_err(io::Error::other)?;
        let ids = town.nearby_roads(Bounds(w - reach, s - reach, e + reach, n + reach), spatial)?;
        let lines = ids
            .into_iter()
            .map(|i| line(&town.streets()[i].points))
            .collect();
        Self::from_lines(lines, spatial)
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
    pub(crate) fn new(
        streets: &[super::network::Street],
        spatial: &'a dyn SpatialKernel,
    ) -> io::Result<Self> {
        Self::from_lines(streets.iter().map(|s| line(&s.points)).collect(), spatial)
    }
    fn from_lines(lines: Vec<Geometry>, spatial: &'a dyn SpatialKernel) -> io::Result<Self> {
        let index = spatial.index(&lines).map_err(io::Error::other)?;
        Ok(Self {
            lines,
            index,
            spatial,
        })
    }
    pub(crate) fn project(&self, at: Point) -> io::Result<Option<Point>> {
        Ok(self.project_onto_street(at)?.map(|(_, p)| p))
    }
    pub(crate) fn project_onto_street(&self, at: Point) -> io::Result<Option<(usize, Point)>> {
        let p = Position::xy(at[0], at[1]);
        let Some(i) = self.index.nearest(p).map_err(io::Error::other)? else {
            return Ok(None);
        };
        let [on_road, _] = self
            .spatial
            .nearest_points(&self.lines[i], &point(at))
            .map_err(io::Error::other)?;
        Ok(Some((i, xy(on_road))))
    }
    /// Walking junctions are stored to the millimetre. Recover their exact
    /// centreline contact before a walked course becomes a routable street.
    pub(crate) fn attach_walk(&self, points: &mut [Point]) -> io::Result<bool> {
        if self.lines.is_empty() {
            return Ok(true);
        }
        if points.len() < 2 {
            return Ok(false);
        }
        let mut joined = false;
        for i in [0, points.len() - 1] {
            if let Some(p) = self.project(points[i])? {
                if distance(p, points[i]) <= JUNCTION_TOLERANCE {
                    points[i] = p;
                    joined = true;
                }
            }
        }
        if joined {
            return Ok(true);
        }
        let trace = line(points);
        let bounds = self.spatial.bounds(&trace).map_err(io::Error::other)?;
        for i in self.index.query(bounds).map_err(io::Error::other)? {
            if self
                .spatial
                .relation(
                    &trace,
                    &self.lines[i],
                    atlas_map::spatial::Predicate::Intersects,
                )
                .map_err(io::Error::other)?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
    pub(crate) fn constrain(
        &self,
        proposal: &[Point; 2],
        spacing: f64,
    ) -> io::Result<Option<(Point, bool)>> {
        local_constraint(
            proposal,
            &self.lines,
            self.index.as_ref(),
            spacing,
            self.spatial,
        )
        .map_err(io::Error::other)
    }
}
fn local_constraint(
    &[start, end]: &[Point; 2],
    geometries: &[Geometry],
    index: &dyn SpatialIndex,
    spacing: f64,
    spatial: &dyn SpatialKernel,
) -> Result<Option<(Point, bool)>, String> {
    // Another investment may already have connected these endpoints by the
    // time this proposal is reconsidered against today's network.
    if distance(start, end) <= JUNCTION_TOLERANCE {
        return Ok(None);
    }
    let join = spacing * JOIN_SHARE;
    let nearby = index.query(Bounds(
        start[0].min(end[0]) - join,
        start[1].min(end[1]) - join,
        start[0].max(end[0]) + join,
        start[1].max(end[1]) + join,
    ))?;
    let candidate = line(&[start, end]);
    let mut crossings = Vec::new();
    for &i in &nearby {
        if let Some(crossing) =
            spatial.overlay(&candidate, &geometries[i], Overlay::Intersection)?
        {
            if spatial.length(&crossing)? > JUNCTION_TOLERANCE {
                return Ok(None);
            }
            positions(&crossing, &mut crossings);
        }
    }
    let crossing = crossings
        .into_iter()
        .filter(|p| distance(*p, start) > JUNCTION_TOLERANCE)
        .min_by(|a, b| distance(*a, start).total_cmp(&distance(*b, start)));
    if crossing.is_some_and(|p| distance(p, start) < spacing * MIN_CONNECTION_SHARE) {
        return Ok(None);
    }
    let mut target = crossing.unwrap_or(end);
    let mut gap = join;
    for &i in nearby.iter().filter(|_| crossing.is_none()) {
        let nearest = xy(spatial.nearest_points(&point(end), &geometries[i])?[1]);
        let d = distance(nearest, end);
        if d < gap && distance(nearest, start) >= spacing * MIN_CONNECTION_SHARE {
            (target, gap) = (nearest, d);
        }
    }
    let joined = crossing.is_some() || gap < join;
    // The middle of a new road needs room for plots. A departure can touch its parent,
    // and a joining end can touch its destination, without paving a second road beside it.
    let middle = point(add(start, scale(sub(target, start), 0.5)));
    for &i in &nearby {
        if spatial.distance(&middle, &geometries[i])? < spacing * STREET_CLEARANCE_SHARE {
            return Ok(None);
        }
    }
    Ok(Some((target, joined)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::{
        fabric::Town,
        network::{Class, Street},
        seat::Seat,
    };

    #[test]
    fn a_snapped_santa_spoza_journey_declines_only_the_collapsed_connection() {
        let spatial = atlas_gis::geometry::NativeGeos::new(0.000001).unwrap();
        let from = [91682.67129439015, 403399.55720964476];
        let destination = [91672.71936467697, 403289.484404];
        let junction = [91672.719365, 403289.484404];
        let mut town = Town::new(
            Seat {
                key: atlas_map::Id::from_name("Santa Spoza"),
                name: "Santa Spoza".into(),
                centre: junction,
                story: Default::default(),
                arms: vec![],
                culture: None,
            },
            None,
        );
        let road = |points| Street::new(points, Class::Street, town.seat.story.size());
        town.set_approaches(vec![road(vec![
            [junction[0], junction[1] - 100.],
            junction,
        ])]);
        let departure = town.project_onto_road(from, &spatial).unwrap().unwrap().1;
        let course = [departure, destination];
        let nearby = StreetLines::near(&town, &course, 60., &spatial).unwrap();
        assert!(nearby.constrain(&course, 60.).unwrap().is_none());

        let crossing = [junction[0], junction[1] + 50.];
        let size = town.seat.story.size();
        town.set_approaches(vec![
            town.streets()[0].clone(),
            Street::new(
                vec![
                    [crossing[0] - 40., crossing[1]],
                    [crossing[0] + 40., crossing[1]],
                ],
                Class::Street,
                size,
            ),
        ]);
        let course = [departure, [junction[0], junction[1] + 100.]];
        let nearby = StreetLines::near(&town, &course, 60., &spatial).unwrap();
        let (at, joined) = nearby.constrain(&course, 60.).unwrap().unwrap();
        assert!(joined && distance(at, crossing) < JUNCTION_TOLERANCE);
    }
}
