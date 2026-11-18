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
    let side = (2 * radius + 1) as usize;
    let origin = [
        departure[0] - radius as f64 * step,
        departure[1] - radius as f64 * step,
    ];
    let point = |i: usize| {
        [
            origin[0] + (i % side) as f64 * step,
            origin[1] + (i / side) as f64 * step,
        ]
    };
    let mut costs = vec![u32::MAX; side * side];
    let mut parent = vec![usize::MAX; costs.len()];
    let mut roots = vec![departure; costs.len()];
    let mut queue = BinaryHeap::new();
    let clear = |a: Point, b: Point, leaving: bool| {
        let direction = unit(sub(b, a));
        let normal = scale(left(direction), width * 0.5);
        resample(&[a, b], cell * 0.5).iter().all(|&p| {
            [p, add(p, normal), sub(p, normal)].iter().all(|&q| {
                let owner = ground.owner(q);
                matches!(owner, FREE | FIELD)
                    || (owner == STEEP && ground.passes_hillside(q, direction))
                    || (leaving && owner >= super::ground::FIRST_STREET)
            })
        })
    };
    let mut seed = |root: Point, bank: Point| {
        let x = ((bank[0] - origin[0]) / step).round() as isize;
        let y = ((bank[1] - origin[1]) / step).round() as isize;
        if !(0..side as isize).contains(&x) || !(0..side as isize).contains(&y) {
            return;
        }
        let i = y as usize * side + x as usize;
        let p = point(i);
        let cost = (1000. * distance(root, p) / step).ceil() as u32;
        if cost < costs[i]
            && matches!(ground.owner(p), FREE | FIELD | STEEP)
            && clear(root, p, true)
        {
            costs[i] = cost;
            roots[i] = root;
            queue.push(Reverse((cost, i)));
        }
    };
    let offset = (street.width() + width) / 2. + cell * 2.;
    for (root, bank) in departures(street, step, offset) {
        if distance(root, departure) <= reach {
            seed(root, bank);
        }
    }
    let mut best = None;
    let mut best_score = 0.;
    while let Some(Reverse((cost, i))) = queue.pop() {
        let walked = f64::from(cost) * step / 1000.;
        if cost != costs[i] || walked > reach {
            continue;
        }
        let p = point(i);
        let remaining = distance(p, destination);
        let progress = unserved_distance - remaining;
        let score = progress - 0.25 * walked;
        if score > best_score && (progress >= frontage || remaining <= width) {
            best = Some(i);
            best_score = score;
        }
        for (j, length) in neighbours(i, side) {
            let next = cost + length;
            if next < costs[j] && clear(p, point(j), false) {
                costs[j] = next;
                parent[j] = i;
                queue.push(Reverse((next, j)));
            }
        }
    }
    simplify_course(best?, &parent, &roots, point, |a, b| clear(a, b, false))
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
fn neighbours(i: usize, side: usize) -> impl Iterator<Item = (usize, u32)> {
    let x = (i % side) as isize;
    let y = (i / side) as isize;
    (-1..=1).flat_map(move |dy| {
        (-1..=1).filter_map(move |dx| {
            let (nx, ny) = (x + dx, y + dy);
            if (dx == 0 && dy == 0)
                || !(0..side as isize).contains(&nx)
                || !(0..side as isize).contains(&ny)
            {
                return None;
            }
            Some((
                ny as usize * side + nx as usize,
                if dx * dy == 0 { 1000 } else { 1415 },
            ))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::{ground::WALL, network::Class, story::Size};

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
