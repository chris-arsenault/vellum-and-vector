//! Lanes and side streets laid between the main streets, by the settlement's layout.
use super::{
    geometry::{
        add, angle, at, cut, heading, left, offset, rest, ring, scale, sub, unit, Jitter, Point,
    },
    ground::{Ground, FIRST_STREET, WALL},
    network::{lane, meets, stops_branch, stops_lane, Class, Street, VERTEX_STEP},
    story::{Layout, Size},
};
use std::f64::consts::{FRAC_PI_2, TAU};

/// What every layout reads: the centre, the place's size, how far it is meant to spread,
/// how deep its plots are and the half-size of its square.
pub struct Lay {
    pub centre: Point,
    pub size: Size,
    pub radius: f64,
    pub depth: f64,
    pub square: f64,
}
/// The streets laid so far; street `i` owns ground `FIRST_STREET + i`.
#[derive(Default)]
pub struct Network {
    pub streets: Vec<Street>,
}
impl Network {
    pub fn add(&mut self, street: Street, ground: &mut Ground) -> u32 {
        let owner = FIRST_STREET + self.streets.len() as u32;
        ground.take_line(&street.points, street.width(), owner);
        self.streets.push(street);
        owner
    }
    fn mains(&self) -> usize {
        self.streets
            .iter()
            .take_while(|s| s.class == Class::Main)
            .count()
    }
}
/// A town wall: its closed line and the gates where main streets pass through it.
pub struct Wall {
    pub ring: Vec<Point>,
    pub gates: Vec<Point>,
}
/// Full thickness of a town wall in metres.
pub const WALL_THICKNESS: f64 = 3.0;
const GATE_WIDTH: f64 = 4.0;
const WALL_SIDES: usize = 14;
/// Lays the layout's lanes after the main streets, returning the wall a walled place builds.
pub fn lanes(
    layout: Layout,
    network: &mut Network,
    lay: &Lay,
    ground: &mut Ground,
    jitter: &mut Jitter,
) -> Option<Wall> {
    match layout {
        Layout::Organic => organic(network, lay, ground, jitter, lay.radius),
        Layout::Grid => grid(network, lay, ground),
        Layout::Radial => radial(network, lay, ground),
        Layout::Linear => linear(network, lay, ground),
        Layout::Walled => return Some(walled(network, lay, ground, jitter)),
    }
    None
}
struct Branching {
    class: Class,
    limit: f64,
    spacing: f64,
    /// Lane length at the parent's start and metres lost per metre along the parent.
    reach: f64,
    taper: f64,
}
/// A line of three legs that turns a little at each bend.
fn bent(start: Point, direction: f64, length: f64, jitter: &mut Jitter) -> Vec<Point> {
    let mut points = vec![start];
    let mut turn = direction;
    for _ in 0..3 {
        let last = points[points.len() - 1];
        points.push(add(last, scale(heading(turn), length / 3.0)));
        turn += jitter.around(0.0, 0.2);
    }
    points
}
fn branches(
    network: &mut Network,
    parent: usize,
    lay: &Lay,
    ground: &mut Ground,
    jitter: &mut Jitter,
    branching: &Branching,
) {
    let street = network.streets[parent].clone();
    let owner = FIRST_STREET + parent as u32;
    let start = if street.class == Class::Main {
        lay.square + lay.depth
    } else {
        lay.depth
    };
    let end = street.length().min(branching.limit);
    let mut along = start;
    while along < end {
        if let Some((p, d)) = at(&street.points, along) {
            let side = if jitter.sample() < 0.5 { 1.0 } else { -1.0 };
            let from = add(p, scale(left(d), side * street.width() / 2.0));
            let direction = angle(d) + side * jitter.around(FRAC_PI_2, 0.35);
            let length = (branching.reach - along * branching.taper).max(2.0 * lay.depth)
                * jitter.around(1.0, 0.3);
            let points = bent(from, direction, length, jitter);
            if let Some(lane) = lane(
                &points,
                branching.class,
                lay.size,
                ground,
                stops_branch(owner),
                lay.depth,
            ) {
                network.add(lane, ground);
            }
        }
        along += branching.spacing * jitter.around(1.0, 0.3);
    }
}
/// Lanes branch off the main streets at irregular intervals and end where they meet another
/// street; in a town, alleys branch off those lanes in turn.
fn organic(network: &mut Network, lay: &Lay, ground: &mut Ground, jitter: &mut Jitter, limit: f64) {
    let mains = network.mains();
    let town = lay.size >= Size::Town;
    let first = Branching {
        class: if town { Class::Street } else { Class::Lane },
        limit,
        spacing: 2.0 * lay.depth + Class::Lane.width(lay.size),
        reach: limit,
        taper: 0.6,
    };
    for parent in 0..mains {
        branches(network, parent, lay, ground, jitter, &first);
    }
    if !town {
        return;
    }
    let second = Branching {
        class: if lay.size == Size::City {
            Class::Lane
        } else {
            Class::Alley
        },
        limit: f64::MAX,
        spacing: 2.0 * lay.depth + Class::Alley.width(lay.size),
        reach: 2.5 * lay.depth,
        taper: 0.0,
    };
    for parent in mains..network.streets.len() {
        branches(network, parent, lay, ground, jitter, &second);
    }
}
/// A straight street through `middle`, as far each way as the ground lets it run.
fn span(middle: Point, run: Point, half: f64, ground: &Ground) -> Vec<Point> {
    let ahead = ground.reach(&[middle, add(middle, scale(run, half))], stops_lane);
    let behind = ground.reach(&[middle, sub(middle, scale(run, half))], stops_lane);
    vec![
        sub(middle, scale(run, behind)),
        add(middle, scale(run, ahead)),
    ]
}
/// Parallel streets in two directions, one block apart, square to the first main street.
fn grid(network: &mut Network, lay: &Lay, ground: &mut Ground) {
    let axis = network
        .streets
        .first()
        .map_or([1.0, 0.0], |s| unit(sub(s.points[1], s.points[0])));
    let spacing = 2.0 * lay.depth + Class::Street.width(lay.size);
    let count = (lay.radius / spacing).ceil() as i32;
    for (run, across) in [(axis, left(axis)), (left(axis), axis)] {
        for k in (-count..=count).filter(|&k| k != 0) {
            let u = f64::from(k) * spacing;
            if u.abs() >= lay.radius {
                continue;
            }
            let half = (lay.radius.powi(2) - u.powi(2)).sqrt();
            let middle = add(lay.centre, scale(across, u));
            let points = span(middle, run, half, ground);
            if let Some(street) = lane(
                &points,
                Class::Street,
                lay.size,
                ground,
                |_| false,
                lay.depth,
            ) {
                network.add(street, ground);
            }
        }
    }
}
/// The arcs of a ring between consecutive main streets, each its own street.
fn arcs(centre: Point, radius: f64, angles: &[f64], gap: f64) -> Vec<Vec<Point>> {
    let bounds: Vec<(f64, f64)> = if angles.is_empty() {
        vec![(0.0, TAU)]
    } else {
        (0..angles.len())
            .map(|i| {
                let a = angles[i];
                let mut b = angles[(i + 1) % angles.len()];
                if b <= a {
                    b += TAU;
                }
                (a + gap, b - gap)
            })
            .collect()
    };
    bounds
        .into_iter()
        .filter(|(a, b)| b > a)
        .map(|(a, b)| {
            let steps = ((b - a) * radius / VERTEX_STEP).ceil().max(1.0) as usize;
            (0..=steps)
                .map(|i| {
                    add(
                        centre,
                        scale(heading(a + (b - a) * i as f64 / steps as f64), radius),
                    )
                })
                .collect()
        })
        .collect()
}
fn main_angles(network: &Network) -> Vec<f64> {
    let mut angles = network.streets[..network.mains()]
        .iter()
        .map(|s| angle(sub(s.points[1], s.points[0])))
        .collect::<Vec<_>>();
    // hpc-exempt: orders a handful of main-street headings around the centre.
    angles.sort_by(f64::total_cmp);
    angles
}
/// Ring streets around the square between the main streets, with spokes where main streets
/// leave wide gaps.
fn radial(network: &mut Network, lay: &Lay, ground: &mut Ground) {
    let angles = main_angles(network);
    let spacing = 2.0 * lay.depth + Class::Street.width(lay.size);
    let mut radius = lay.square + spacing;
    while radius < lay.radius {
        let gap = (Class::Main.width(lay.size) / 2.0 + 1.0) / radius;
        for arc in arcs(lay.centre, radius, &angles, gap) {
            if let Some(street) = lane(&arc, Class::Street, lay.size, ground, stops_lane, lay.depth)
            {
                network.add(street, ground);
            }
        }
        radius += spacing;
    }
    for (i, &a) in angles.iter().enumerate() {
        let b = angles.get(i + 1).copied().unwrap_or(angles[0] + TAU);
        if b - a > 1.2 {
            let direction = heading(a + (b - a) / 2.0);
            let points = [
                add(lay.centre, scale(direction, lay.square + spacing / 2.0)),
                add(lay.centre, scale(direction, lay.radius)),
            ];
            if let Some(street) = lane(
                &points,
                Class::Street,
                lay.size,
                ground,
                stops_lane,
                lay.depth,
            ) {
                network.add(street, ground);
            }
        }
    }
}
/// Back lanes behind the plots on each side of the main streets.
fn linear(network: &mut Network, lay: &Lay, ground: &mut Ground) {
    if lay.size < Size::Village {
        return;
    }
    for main in 0..network.mains() {
        let street = network.streets[main].clone();
        let inner = cut(&street.points, lay.radius.min(street.length()));
        for side in [1.0, -1.0] {
            let by =
                side * (street.width() / 2.0 + lay.depth + Class::Lane.width(lay.size) / 2.0 + 1.0);
            let line = rest(&offset(&inner, by), lay.square + lay.depth);
            if let Some(back) = lane(&line, Class::Lane, lay.size, ground, stops_lane, lay.depth) {
                network.add(back, ground);
            }
        }
    }
}
/// A wall around the old core with gates on the main streets; lanes inside it only.
fn walled(network: &mut Network, lay: &Lay, ground: &mut Ground, jitter: &mut Jitter) -> Wall {
    let radius = (lay.radius * 0.7).max(lay.square + 3.0 * lay.depth);
    let wobble = (0..WALL_SIDES)
        .map(|_| jitter.around(0.0, 0.06))
        .collect::<Vec<_>>();
    let line = ring(lay.centre, radius, WALL_SIDES, |i| wobble[i]);
    let gates = network.streets[..network.mains()]
        .iter()
        .filter_map(|s| meets(&s.points, &line).into_iter().next())
        .collect::<Vec<_>>();
    let mains = network.mains();
    for street in &mut network.streets[..mains] {
        street.pinch(&gates, 1.5 * VERTEX_STEP, GATE_WIDTH);
    }
    ground.take_line(&line, WALL_THICKNESS, WALL);
    organic(network, lay, ground, jitter, radius);
    Wall { ring: line, gates }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn town(layout: Layout) -> (Network, Option<Wall>) {
        let mut ground = Ground::new([-400.0, -400.0, 400.0, 400.0], 2.0);
        let lay = Lay {
            centre: [0.0, 0.0],
            size: Size::Town,
            radius: 250.0,
            depth: 24.0,
            square: 20.0,
        };
        let mut network = Network::default();
        for direction in [[1.0, 0.0], [-1.0, 0.0], [0.0, 1.0]] {
            let street = Street::new(
                super::super::geometry::resample(
                    &[[0.0, 0.0], scale(direction, 390.0)],
                    VERTEX_STEP,
                ),
                Class::Main,
                Size::Town,
            );
            network.add(street, &mut ground);
        }
        let wall = lanes(
            layout,
            &mut network,
            &lay,
            &mut ground,
            &mut Jitter::new("test"),
        );
        (network, wall)
    }
    #[test]
    fn every_layout_lays_lanes_between_its_main_streets() {
        for layout in [
            Layout::Organic,
            Layout::Grid,
            Layout::Radial,
            Layout::Linear,
        ] {
            let (network, wall) = town(layout);
            assert!(network.streets.len() > 3, "{layout:?} laid no lanes");
            assert!(wall.is_none());
            assert!(network.streets[3..].iter().all(|s| s.class != Class::Main));
        }
        let (network, wall) = town(Layout::Walled);
        let wall = wall.unwrap();
        assert_eq!(wall.gates.len(), 3);
        assert_eq!(wall.ring.first(), wall.ring.last());
        assert!(network.streets[..3]
            .iter()
            .all(|s| s.widths.contains(&GATE_WIDTH)));
        let inside = 250.0 * 0.7 * 1.07;
        assert!(network.streets[3..]
            .iter()
            .flat_map(|s| s.points.iter())
            .all(|p| super::super::geometry::length(*p) <= inside + 30.0));
    }
    #[test]
    fn arcs_run_between_main_street_headings() {
        let arcs = arcs([0.0, 0.0], 100.0, &[0.0, FRAC_PI_2], 0.1);
        assert_eq!(arcs.len(), 2);
        assert!(arcs.iter().all(|arc| arc
            .iter()
            .all(|p| (super::super::geometry::length(*p) - 100.0).abs() < 1e-9)));
    }
}
