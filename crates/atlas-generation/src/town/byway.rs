use super::{
    geometry::{add, distance, left, resample, scale, sub, unit, Point},
    ground::{Ground, FIELD, FREE, STEEP},
    network::Street,
};
use std::{cmp::Reverse, collections::BinaryHeap};

pub struct Journey {
    pub departure: Point,
    pub destination: Point,
    /// Gap from the existing network, including streets built on earlier passes.
    pub unserved_distance: f64,
}

/// A byway can spend this round's investment reaching a terrace on the way to
/// its destination. Start at the accessible edge of the existing street and
/// follow ground wide enough for the required traffic.
// owner-direction(2026-11-18): a cramped mountain town with small byways is a realistic goal
pub fn course(
    street: &Street,
    journey: Journey,
    ground: &Ground,
    width: f64,
    reach: f64,
    frontage: f64,
) -> Option<Vec<Point>> {
    survey(street, journey, ground, width, reach, Some(frontage))
}

/// A district access road must reach its occupied quarter before it supplies frontage.
pub(crate) fn connection(
    street: &Street,
    journey: Journey,
    ground: &Ground,
    width: f64,
    reach: f64,
) -> Option<Vec<Point>> {
    survey(street, journey, ground, width, reach, None)
}

struct PartialCourse {
    frontage: f64,
    best: Option<usize>,
    score: f64,
}

impl PartialCourse {
    fn can_still_reach(&self, gap: f64, walked: f64) -> bool {
        gap - 0.25 * walked >= self.score
    }

    fn consider(&mut self, i: usize, gap: f64, walked: f64, remaining: f64, width: f64) {
        let progress = gap - remaining;
        let score = progress - 0.25 * walked;
        if score > self.score && (progress >= self.frontage || remaining <= width) {
            self.best = Some(i);
            self.score = score;
        }
    }
}

struct SurveyGrid {
    origin: Point,
    step: f64,
    columns: usize,
    rows: usize,
}

enum SurveyStep {
    Explore,
    BeyondReach,
    Arrived,
    Exhausted,
}

struct SurveyGoal {
    destination: Point,
    initial_gap: f64,
    width: f64,
    reach: f64,
    partial: Option<PartialCourse>,
}

impl SurveyGoal {
    fn assess(&mut self, i: usize, grid: &SurveyGrid, walked: f64, ground: &Ground) -> SurveyStep {
        let p = grid.point(i);
        let remaining = distance(p, self.destination);
        match &mut self.partial {
            Some(survey) if !survey.can_still_reach(self.initial_gap, walked) => {
                SurveyStep::Exhausted
            }
            Some(survey) => {
                survey.consider(i, self.initial_gap, walked, remaining, self.width);
                SurveyStep::Explore
            }
            None if walked + remaining > self.reach => SurveyStep::BeyondReach,
            None if remaining <= grid.step
                && clears_width(ground, self.width, p, self.destination, false) =>
            {
                SurveyStep::Arrived
            }
            None => SurveyStep::Explore,
        }
    }
}

impl SurveyGrid {
    fn point(&self, i: usize) -> Point {
        [
            self.origin[0] + (i % self.columns) as f64 * self.step,
            self.origin[1] + (i / self.columns) as f64 * self.step,
        ]
    }

    fn entry(&self, root: Point, bank: Point, ground: &Ground, width: f64) -> Option<(usize, u32)> {
        let x = ((bank[0] - self.origin[0]) / self.step).round() as isize;
        let y = ((bank[1] - self.origin[1]) / self.step).round() as isize;
        if !(0..self.columns as isize).contains(&x) || !(0..self.rows as isize).contains(&y) {
            return None;
        }
        let i = y as usize * self.columns + x as usize;
        let p = self.point(i);
        (matches!(ground.owner(p), FREE | FIELD | STEEP)
            && clears_width(ground, width, root, p, true))
        .then(|| (i, (1000. * distance(root, p) / self.step).ceil() as u32))
    }
}

fn survey(
    street: &Street,
    journey: Journey,
    ground: &Ground,
    width: f64,
    reach: f64,
    partial: Option<f64>,
) -> Option<Vec<Point>> {
    let Journey {
        departure,
        destination,
        unserved_distance,
    } = journey;
    if unserved_distance <= width / 2. {
        return None;
    }
    let cell = ground.cell;
    let step = cell.max(width);
    let radius = (2. * reach / step).ceil() as isize;
    // Preserve the survey lattice at the departure, but allocate only ground on the map.
    let axis = |i: usize, cells: usize| {
        let first = ((ground.origin[i] - departure[i]) / step)
            .ceil()
            .max(-radius as f64);
        let last = ((ground.origin[i] + cells as f64 * cell - departure[i]) / step)
            .floor()
            .min(radius as f64);
        (
            departure[i] + first * step,
            (last - first + 1.).max(0.) as usize,
        )
    };
    let (west, columns) = axis(0, ground.columns);
    let (south, rows) = axis(1, ground.rows);
    let grid = SurveyGrid {
        origin: [west, south],
        step,
        columns,
        rows,
    };
    let point = |i| grid.point(i);
    let mut costs = vec![u32::MAX; columns * rows];
    let mut parent = vec![usize::MAX; costs.len()];
    let mut roots = vec![departure; costs.len()];
    let mut queue = BinaryHeap::new();
    let goal = partial.is_none().then_some(destination);
    let estimate = |i| goal.map_or(0, |p| (distance(point(i), p) * 1000. / step).floor() as u64);
    let clear = |a, b, leaving| clears_width(ground, width, a, b, leaving);
    let offset = (street.width() + width) / 2. + cell * 2.;
    let entries = departures(street, step, offset)
        .filter(|(p, _)| distance(*p, departure) <= reach)
        .filter_map(|(root, bank)| {
            grid.entry(root, bank, ground, width)
                .map(|(i, cost)| (root, i, cost))
        });
    for (root, i, cost) in entries {
        if cost < costs[i] {
            costs[i] = cost;
            roots[i] = root;
            queue.push(Reverse((u64::from(cost) + estimate(i), cost, i)));
        }
    }
    let partial = partial.map(|frontage| PartialCourse {
        frontage,
        best: None,
        score: 0.,
    });
    let mut target = SurveyGoal {
        destination,
        initial_gap: unserved_distance,
        width,
        reach,
        partial,
    };
    while let Some(Reverse((_, cost, i))) = queue.pop() {
        let walked = f64::from(cost) * step / 1000.;
        if cost != costs[i] || walked > reach {
            continue;
        }
        let p = point(i);
        match target.assess(i, &grid, walked, ground) {
            SurveyStep::Exhausted => break,
            SurveyStep::BeyondReach => continue,
            SurveyStep::Arrived => {
                let mut path =
                    simplify_course(i, &parent, &roots, point, |a, b| clear(a, b, false))?;
                path.extend((distance(p, destination) > 0.001).then_some(destination));
                return Some(path);
            }
            SurveyStep::Explore => {}
        }
        for (j, length) in neighbours(i, columns, rows) {
            let next = cost + length;
            if next < costs[j] && clear(p, point(j), false) {
                costs[j] = next;
                parent[j] = i;
                queue.push(Reverse((u64::from(next) + estimate(j), next, j)));
            }
        }
    }
    simplify_course(target.partial?.best?, &parent, &roots, point, |a, b| {
        clear(a, b, false)
    })
}

fn clears_width(ground: &Ground, width: f64, a: Point, b: Point, leaving: bool) -> bool {
    let direction = unit(sub(b, a));
    clear_section(ground.cell, width, a, b, |q| {
        let owner = ground.owner(q);
        matches!(owner, FREE | FIELD)
            || (owner == STEEP && ground.passes_hillside(q, direction))
            || (leaving && owner >= super::ground::FIRST_STREET)
    })
}
fn clear_section(
    cell: f64,
    width: f64,
    a: Point,
    b: Point,
    permitted: impl Fn(Point) -> bool,
) -> bool {
    let direction = unit(sub(b, a));
    let normal = scale(left(direction), width * 0.5);
    resample(&[a, b], cell * 0.5).into_iter().all(|p| {
        [p, add(p, normal), sub(p, normal)]
            .into_iter()
            .all(&permitted)
    })
}

pub(crate) struct RightOfWay {
    pub corridor: atlas_map::Geometry,
    pub obstacles: Option<atlas_map::Geometry>,
}
/// Survey the buildable width close to an established walk. The walking ground
/// supplies terrain, the occupied ground supplies reserved works, and the exact
/// roofs and protected parcels bound how far the public right of way can move.
pub(crate) fn walked_connection(
    walk: &[Point],
    width: f64,
    area: &RightOfWay,
    walking: &Ground,
    occupied: &Ground,
    spatial: &dyn crate::spatial::SpatialKernel,
) -> std::io::Result<Option<Vec<Point>>> {
    use atlas_map::spatial::Overlay;
    use std::io::Error;
    let mut room = area.corridor.clone();
    if let Some(obstructions) = &area.obstacles {
        // Buffered circular corners are chords; leave clearance for the final true-width road.
        let margin = width / 2. * 1.01;
        let Some(keep_out) = spatial.buffer(obstructions, margin).map_err(Error::other)? else {
            return Ok(None);
        };
        let Some(free) = spatial
            .overlay(&room, &keep_out, Overlay::Difference)
            .map_err(Error::other)?
        else {
            return Ok(None);
        };
        room = free;
    }
    let pos = |p: Point| atlas_map::Position::xy(p[0], p[1]);
    let ends = atlas_map::Geometry::MultiPoint {
        coordinates: vec![pos(walk[0]), pos(*walk.last().unwrap())],
    };
    let parts = match room {
        atlas_map::Geometry::MultiPolygon { coordinates } => coordinates
            .into_iter()
            .map(|coordinates| atlas_map::Geometry::Polygon { coordinates })
            .collect(),
        shape => vec![shape],
    };
    for part in parts {
        let mask = spatial.prepare_area(&part).map_err(Error::other)?;
        if !mask.covers(&ends).map_err(Error::other)? {
            continue;
        }
        let clear = |a: Point, b: Point| -> std::io::Result<bool> {
            let direction = unit(sub(b, a));
            if !mask
                .covers(&super::edits::line(&[a, b]))
                .map_err(Error::other)?
            {
                return Ok(false);
            }
            Ok(clear_section(walking.cell, width, a, b, |p| {
                let owner = walking.owner(p);
                let grade = owner != STEEP || walking.passes_hillside(p, direction);
                grade
                    && !matches!(
                        owner,
                        super::ground::WATER | super::ground::WALL | super::ground::OUTSIDE
                    )
                    && occupied.owner(p) != super::ground::SQUARE
                    && !walking.ploughed(p)
            }))
        };
        return passage_through(&part, walk, spatial, clear);
    }
    Ok(None)
}

/// Route around the corners of the available land. Triangulating just this
/// corridor keeps the number of visibility edges proportional to its boundaries.
fn passage_through(
    room: &atlas_map::Geometry,
    walk: &[Point],
    spatial: &dyn crate::spatial::SpatialKernel,
    clear: impl Fn(Point, Point) -> std::io::Result<bool>,
) -> std::io::Result<Option<Vec<Point>>> {
    use std::io::Error;
    let mut points = vec![walk[0], *walk.last().unwrap()];
    if clear(points[0], points[1])? {
        return Ok(Some(points));
    }
    let mut edges = Vec::new();
    let mut ids = std::collections::BTreeMap::new(); // hpc-exempt: vertices of this surveyed right of way.
    let key = super::access::JunctionId::at;
    ids.extend([(key(points[0]), 0), (key(points[1]), 1)]);
    let mut add = |p: Point| {
        *ids.entry(key(p)).or_insert_with(|| {
            points.push(p);
            points.len() - 1
        })
    };
    for ring in atlas_map::regions::boundary_lines(room) {
        let indices: Vec<_> = ring
            .into_iter()
            .map(|p| {
                let [x, y, _] = p.coordinates();
                add([x, y])
            })
            .collect();
        edges.extend(indices.windows(2).map(|p| [p[0], p[1]]));
    }
    let positions = walk
        .iter()
        .map(|p| atlas_map::Position::xy(p[0], p[1]))
        .collect::<Vec<_>>();
    let mut previous = None;
    for (&p, inside) in walk.iter().zip(
        spatial
            .covers_points(room, &positions)
            .map_err(Error::other)?,
    ) {
        let current = inside.then(|| add(p));
        if let (Some(a), Some(b)) = (previous, current) {
            edges.push([a, b]);
        }
        previous = current;
    }
    let vertices: Vec<_> = points
        .iter()
        .map(|p| atlas_map::Position::xy(p[0], p[1]))
        .collect();
    edges.extend(spatial.delaunay_edges(&vertices).map_err(Error::other)?);
    let mut adjoining = vec![Vec::new(); points.len()];
    for [a, b] in edges {
        adjoining[a].push(b);
        adjoining[b].push(a);
    }
    let mut parents = vec![usize::MAX; points.len()];
    let mut costs = vec![u64::MAX; points.len()];
    costs[0] = 0;
    let mut queue = BinaryHeap::from([Reverse((0, 0, 0usize))]);
    while let Some(Reverse((_, cost, i))) = queue.pop() {
        if cost != costs[i] {
            continue;
        }
        if i == 1 {
            return straightened_passage(&points, &parents, &clear).map(Some);
        }
        for &j in &adjoining[i] {
            let next = cost + (1000. * distance(points[i], points[j])).round() as u64;
            if next < costs[j] && clear(points[i], points[j])? {
                costs[j] = next;
                parents[j] = i;
                let estimate = (1000. * distance(points[j], points[1])).floor() as u64;
                queue.push(Reverse((next + estimate, next, j)));
            }
        }
    }
    Ok(None)
}

fn straightened_passage(
    points: &[Point],
    parents: &[usize],
    clear: &impl Fn(Point, Point) -> std::io::Result<bool>,
) -> std::io::Result<Vec<Point>> {
    let mut ordered = vec![points[1]];
    let mut i = 1;
    while i != 0 {
        i = parents[i];
        ordered.push(points[i]);
    }
    ordered.reverse();
    let mut path = vec![ordered[0]];
    i = 0;
    while i + 1 < ordered.len() {
        let mut j = ordered.len() - 1;
        while j > i + 1 && !clear(ordered[i], ordered[j])? {
            j -= 1;
        }
        path.push(ordered[j]);
        i = j;
    }
    Ok(path)
}

/// Keep the bends required for clearance and discard intermediate grid vertices.
fn simplify_course(
    mut i: usize,
    parent: &[usize],
    roots: &[Point],
    point: impl Fn(usize) -> Point,
    clear: impl Fn(Point, Point) -> bool,
) -> Option<Vec<Point>> {
    let mut path = vec![point(i)];
    while parent[i] != usize::MAX {
        i = parent[i];
        path.push(point(i));
    }
    path.reverse();
    let mut points = vec![roots[i], path[0]];
    let mut i = 0;
    while i + 1 < path.len() {
        let j = (i + 1..path.len())
            .rev()
            .find(|&j| clear(path[i], path[j]))?;
        points.push(path[j]);
        i = j;
    }
    Some(points)
}

fn departures(
    street: &Street,
    step: f64,
    offset: f64,
) -> impl Iterator<Item = (Point, Point)> + '_ {
    street.points.windows(2).flat_map(move |leg| {
        let normal = scale(left(unit(sub(leg[1], leg[0]))), offset);
        resample(leg, step)
            .into_iter()
            .flat_map(move |root| [(root, sub(root, normal)), (root, add(root, normal))])
    })
}

/// Orthogonal and diagonal distances in thousandths of a search cell.
fn neighbours(i: usize, columns: usize, rows: usize) -> impl Iterator<Item = (usize, u32)> {
    let x = (i % columns) as isize;
    let y = (i / columns) as isize;
    (-1..=1).flat_map(move |dy| {
        (-1..=1).filter_map(move |dx| {
            let (nx, ny) = (x + dx, y + dy);
            if (dx == 0 && dy == 0)
                || !(0..columns as isize).contains(&nx)
                || !(0..rows as isize).contains(&ny)
            {
                return None;
            }
            Some((
                ny as usize * columns + nx as usize,
                if dx * dy == 0 { 1000 } else { 1415 },
            ))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::{ground::WALL, network::Class, story::Size};
    fn outline(points: &[Point]) -> atlas_map::Geometry {
        let mut ring = points.to_vec();
        ring.push(points[0]);
        crate::town::fabric::polygon(&ring)
    }

    fn occupied_passage(
        walk: &[Point],
        protected: &[atlas_map::Geometry],
        width: f64,
    ) -> Option<Vec<Point>> {
        use crate::spatial::SpatialKernel;
        let spatial = atlas_gis::geometry::NativeGeos::new(0.001).unwrap();
        let ground = Ground::new([-50., -90., 70., 65.], 0.75);
        let mut occupied = ground.clone();
        for &p in [walk.first().unwrap(), walk.last().unwrap()] {
            occupied.take_line(
                &[[p[0] - 4., p[1]], [p[0] + 4., p[1]]],
                3.,
                super::super::ground::FIRST_STREET,
            );
        }
        let room = spatial
            .buffer(&crate::town::edits::line(walk), 6.)
            .unwrap()
            .unwrap();
        let area = RightOfWay {
            corridor: room,
            obstacles: if protected.is_empty() {
                None
            } else {
                spatial.union_all(protected).unwrap()
            },
        };
        let route = walked_connection(walk, width, &area, &ground, &occupied, &spatial).unwrap()?;
        let full_width = spatial
            .buffer(&crate::town::edits::line(&route), width / 2.)
            .unwrap()
            .unwrap();
        assert!(spatial
            .intersection_areas(&full_width, protected)
            .unwrap()
            .iter()
            .all(|&area| area < 0.0001));
        assert_eq!([route.first(), route.last()], [walk.first(), walk.last()]);
        Some(route)
    }

    #[test]
    fn a_takaoka_alley_fits_between_the_occupied_row_and_the_public_square() {
        // Shiro Lane to High Street, measured in metres from the first contact.
        let walk = [
            [0., 0.],
            [16.2, -3.12],
            [27.96, -16.73],
            [24.47, -30.55],
            [22.20, -36.87],
            [23.70, -39.87],
            [25.95, -42.87],
            [31.2, -48.12],
            [44.71, -59.47],
        ];
        let protected = [
            outline(&[
                [23.15, -36.7],
                [31.62, -28.21],
                [34.64, -31.22],
                [26.17, -39.71],
            ]),
            outline(&[
                [22.09, -33.03],
                [17.42, -28.56],
                [22.17, -23.6],
                [26.84, -28.07],
            ]),
            outline(&[
                [11.44, -54.17],
                [22.71, -42.86],
                [30.66, -50.79],
                [19.38, -62.09],
            ]),
        ];
        assert!(occupied_passage(&walk, &protected, 3.5).is_none());
        assert!(occupied_passage(&walk, &protected, 2.5).is_some());
    }

    #[test]
    fn the_occupied_santa_court_and_field_leave_only_a_pedestrian_link() {
        // Menfi Alley to Alto Scamermo Wynd, with the two claims that close the pinch point.
        let walk = [
            [0., 0.],
            [8.64, 14.22],
            [-12.18, 30.05],
            [-6.06, 37.05],
            [-6.06, 37.8],
            [-18.43, 38.45],
        ];
        let protected = [
            outline(&[
                [-21.62, 36.57],
                [-21.04, 37.],
                [-19.6, 36.81],
                [-17.93, 34.59],
                [-13.6, 37.83],
                [-10.52, 33.71],
                [-13.78, 31.27],
                [-18.53, 34.89],
                [-20.22, 32.66],
                [-20.45, 32.97],
                [-20.01, 36.36],
            ]),
            outline(&[
                [-12.18, 30.05],
                [1.88, 40.56],
                [0.61, 37.38],
                [7.91, 34.45],
                [8.64, 14.22],
            ]),
        ];
        assert!(occupied_passage(&walk, &protected, 2.5).is_none());
    }

    #[test]
    fn a_hillside_has_different_grades_along_and_across_its_contour() {
        let mut ground = Ground::new([0., 0., 12., 12.], 1.);
        let point = [6., 6.];
        let cell = ground.index(point).unwrap();
        ground.withhold(cell, STEEP);
        ground.set_hillside(cell, [0.8, 0.05]);
        assert!(ground.passes_hillside(point, [0., 1.]));
        assert!(!ground.passes_hillside(point, [1., 0.]));
    }

    #[test]
    fn a_byway_can_turn_around_a_wall_and_reach_the_far_side() {
        let mut ground = Ground::new([0., 0., 80., 70.], 1.);
        for i in ground.cells_within([29., 0., 34., 38.]) {
            ground.withhold(i, WALL);
        }
        let street = Street::new(vec![[16., 24.], [16., 32.]], Class::Street, Size::Town);
        let destination = [44., 30.];
        let journey = |unserved_distance| Journey {
            departure: [16., 30.],
            destination,
            unserved_distance,
        };
        let route = course(&street, journey(28.), &ground, 2.5, 60., 8.).unwrap();
        assert!(route.iter().any(|p| p[1] > 38.));
        assert!(distance(*route.last().unwrap(), destination) < 2.5);
        for p in resample(&route, ground.cell / 2.) {
            assert_ne!(ground.owner(p), WALL);
        }
        assert!(course(&street, journey(1.), &ground, 2.5, 60., 8.).is_none());
    }
}
