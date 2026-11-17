//! Lays one settlement: its square, main streets from the ways in, lanes by layout, plots
//! nearest the centre first, a building with a use on each, addresses and wards.
use super::{
    addresses::numbers,
    geometry::{add, cut, distance, rectangle, resample, rest, scale, sub, unit, Jitter, Point},
    ground::{Ground, Rectangle, PLOT, SQUARE},
    lanes::{grow, lanes, Lay, Network, Wall},
    network::{main_street, Arm, Class, Street, VERTEX_STEP},
    plots::{barn, building, growth, plot_size, slots, take, take_keyed, Side, Slot},
    settings::{square_half, PACKING},
    story::{layout, Layout, Size, Story},
    uses::{household, ordinary, prefers, special, Needs, Prefers, Use},
    wards::Wards,
};

/// A settlement as its record and the ways around it tell it.
pub struct Seat {
    pub key: String,
    pub name: String,
    pub centre: Point,
    pub story: Story,
    pub arms: Vec<Arm>,
    pub culture: Option<String>,
}
pub struct Plot {
    pub slot: Slot,
    pub use_: Use,
    pub building: Vec<Point>,
    pub barn: Option<Vec<Point>>,
    pub number: u32,
    pub ward: usize,
    pub occupants: u32,
}
pub struct Plan {
    pub seat: Seat,
    pub size: Size,
    pub layout: Layout,
    pub square: Option<Vec<Point>>,
    pub streets: Vec<Street>,
    pub plots: Vec<Plot>,
    pub wall: Option<Wall>,
    pub wards: Option<Wards>,
    /// How far from the centre the place is built.
    pub built: f64,
    /// People still waiting for a home when the place's open ground was used up.
    pub unhoused: u32,
}
fn needs(story: &Story, layout: Layout) -> Needs {
    Needs {
        people: story.people,
        size: story.size(),
        ways: story.ways,
        waterside: story.waterside,
        walled: layout == Layout::Walled,
        seat: story.seat,
    }
}
/// Lays a settlement on the ground, which keeps what it takes.
pub fn lay(seat: Seat, ground: &mut Ground, forced: Option<Layout>) -> Plan {
    let size = seat.story.size();
    let layout = layout(&seat.story, forced);
    let needs = needs(&seat.story, layout);
    let specials = special(&needs);
    let planned: f64 = specials.iter().map(|u| u.occupants(size)).sum();
    let (_, depth) = plot_size(size);
    let lay = Lay {
        centre: seat.centre,
        size,
        radius: spread(size, ordinary(&needs, planned).len() + specials.len()),
        depth,
        square: square_half(size),
    };
    let mut jitter = Jitter::new(&seat.key);
    let square = market(&seat, &lay, ground);
    let mut network = Network::default();
    for arm in &seat.arms {
        if let Some(street) = main_street(arm, f64::MAX, size, ground) {
            network.add(street, ground);
        }
    }
    let wall = lanes(layout, &mut network, &lay, ground, &mut jitter);
    let mut placed = place_specials(&specials, &network.streets, &lay, ground);
    // The people of a special building that found no place live in ordinary homes instead.
    let housed: f64 = placed.iter().map(|(_, u)| u.occupants(size)).sum();
    let waiting = settle(
        ordinary(&needs, housed),
        &mut network,
        &lay,
        ground,
        &mut jitter,
    );
    placed.extend(waiting.placed);
    let unhoused = (waiting.left as f64 * household(size)).round() as u32;
    let mut streets = network.streets;
    let built = placed
        .iter()
        .map(|(slot, _)| distance(slot.front, seat.centre) + slot.depth)
        .fold(lay.square, f64::max);
    split_mains(&mut streets, &placed, size);
    let wards = (size >= Size::Town).then(|| wards(&streets, seat.centre, wall.as_ref()));
    let plots = finish(placed, size, wards.as_ref(), &mut jitter);
    Plan {
        seat,
        size,
        layout,
        square,
        streets,
        plots,
        wall,
        wards,
        built,
        unhoused,
    }
}
/// Homes placed and homes still waiting once the open ground is used.
struct Settled {
    placed: Vec<(Slot, Use)>,
    left: usize,
}
/// While the streets laid so far front fewer open plots than there are homes to build, the
/// place grows new lanes from its newest streets, whose frontage is still open, through open
/// ground; growth ends when no new lane can be laid. Homes then take plots nearest the centre.
fn settle(
    homes: Vec<Use>,
    network: &mut Network,
    lay: &Lay,
    ground: &mut Ground,
    jitter: &mut Jitter,
) -> Settled {
    let (mut from, mut round) = (0, 0);
    let mut placed = Vec::new();
    let mut waiting = homes;
    loop {
        let mut grown = false;
        while open_plots(&network.streets, lay, ground) < waiting.len() {
            round += 1;
            let before = network.streets.len();
            grow(network, from, lay, ground, jitter, round);
            if network.streets.len() == before {
                break;
            }
            (from, grown) = (before, true);
        }
        let (housed, rest) = place_homes(waiting, &network.streets, lay, ground);
        placed.extend(housed);
        waiting = rest;
        // Plots counted open can overlap; while people wait and lanes still grow, go on.
        if waiting.is_empty() || !grown {
            break;
        }
    }
    Settled {
        placed,
        left: waiting.len(),
    }
}
/// How many ordinary plots the streets still front on open ground.
fn open_plots(streets: &[Street], lay: &Lay, ground: &Ground) -> usize {
    let (frontage, depth) = plot_size(lay.size);
    streets
        .iter()
        .enumerate()
        .flat_map(|(i, s)| slots(i, s, frontage, depth))
        .filter(|slot| {
            let street = super::ground::FIRST_STREET + slot.street as u32;
            ground.open(&Rectangle(&slot.corners), street)
        })
        .count()
}
/// How far from its centre a place of this many plots means to spread.
fn spread(size: Size, plots: usize) -> f64 {
    let (frontage, depth) = plot_size(size);
    (plots as f64 * frontage * depth / PACKING / std::f64::consts::PI)
        .sqrt()
        .max(2.0 * depth)
}
/// Houses and workshops take ordinary plots nearest the centre, main streets first; returns
/// those placed and those still waiting for a plot.
fn place_homes(
    homes: Vec<Use>,
    streets: &[Street],
    lay: &Lay,
    ground: &mut Ground,
) -> (Vec<(Slot, Use)>, Vec<Use>) {
    let (frontage, depth) = plot_size(lay.size);
    let candidates = streets
        .iter()
        .enumerate()
        .flat_map(|(i, s)| slots(i, s, frontage, depth))
        .collect();
    let taken = take(
        candidates,
        ground,
        PLOT,
        homes.len(),
        growth(lay.centre, streets),
    );
    let mut homes = homes.into_iter();
    let placed = taken.into_iter().zip(homes.by_ref()).collect();
    (placed, homes.collect())
}
fn wards(streets: &[Street], centre: Point, wall: Option<&Wall>) -> Wards {
    let headings = streets
        .iter()
        .filter(|s| s.class == Class::Main)
        .map(|s| super::geometry::angle(sub(s.points[1], s.points[0])))
        .collect::<Vec<_>>();
    Wards::new(centre, &headings, wall.map(|w| w.ring.clone()))
}
/// The market square, turned to the first way in.
fn market(seat: &Seat, lay: &Lay, ground: &mut Ground) -> Option<Vec<Point>> {
    if lay.square <= 0.0 {
        return None;
    }
    let axis = seat
        .arms
        .first()
        .and_then(|a| a.points.get(1).map(|p| unit(sub(*p, a.points[0]))))
        .unwrap_or([1.0, 0.0]);
    let across = super::geometry::left(axis);
    let front = add(seat.centre, scale(across, -lay.square));
    let corners = rectangle(front, axis, across, 2.0 * lay.square, 2.0 * lay.square);
    ground.take(&Rectangle(&corners), SQUARE);
    Some(corners)
}
/// How much a building that wants `prefers` likes a plot place; lower is better.
fn preference(
    prefers: Prefers,
    slot: &Slot,
    streets: &[Street],
    lay: &Lay,
    ground: &Ground,
) -> f64 {
    const ELSEWHERE: f64 = 1e6;
    let main = streets[slot.street].class == Class::Main;
    let from_centre = distance(slot.front, lay.centre);
    match prefers {
        Prefers::Centre => from_centre + if main { 0.0 } else { ELSEWHERE },
        Prefers::MainAt(share) => {
            (from_centre - share * lay.radius).abs() + if main { 0.0 } else { ELSEWHERE }
        }
        Prefers::SideAt(share) => {
            (from_centre - share * lay.radius).abs() + if main { ELSEWHERE } else { 0.0 }
        }
        Prefers::Water => {
            let behind = add(slot.front, scale(slot.inward, slot.depth + 4.0));
            from_centre
                + if ground.is_water(behind) {
                    0.0
                } else {
                    2.0 * ELSEWHERE
                }
        }
    }
}
/// Buildings with wide plots of their own take the places they prefer first; one that must
/// stand by water and finds none is not built.
fn place_specials(
    specials: &[Use],
    streets: &[Street],
    lay: &Lay,
    ground: &mut Ground,
) -> Vec<(Slot, Use)> {
    let (frontage, depth) = plot_size(lay.size);
    let mut placed = Vec::new();
    for &use_ in specials {
        let Some(prefers) = prefers(use_) else {
            continue;
        };
        let (wide, deep) = use_.footprint(lay.size);
        let (wide, deep) = ((wide + 2.0).max(frontage), (deep + 4.0).max(depth));
        let keyed = streets
            .iter()
            .enumerate()
            .flat_map(|(i, s)| slots(i, s, wide, deep))
            .map(|s| (preference(prefers, &s, streets, lay, ground), s))
            .filter(|(key, _)| *key < 1.5e6)
            .collect();
        if let Some(slot) = take_keyed(keyed, ground, PLOT, 1).pop() {
            placed.push((slot, use_));
        }
    }
    placed
}
/// Beyond its last plot a main street runs on as the open road it is.
fn split_mains(streets: &mut Vec<Street>, placed: &[(Slot, Use)], size: Size) {
    let mains = streets.iter().filter(|s| s.class == Class::Main).count();
    for i in 0..mains {
        let edge = placed
            .iter()
            .filter(|(slot, _)| slot.street == i)
            .map(|(slot, _)| slot.along + slot.frontage)
            .fold(square_half(size) + VERTEX_STEP, f64::max);
        let street = &mut streets[i];
        if street.length() <= edge + 2.0 * VERTEX_STEP {
            continue;
        }
        let mut road = Street::new(
            resample(&rest(&street.points, edge), VERTEX_STEP),
            Class::Road,
            size,
        );
        road.destination.clone_from(&street.destination);
        road.bridges = street
            .bridges
            .iter()
            .filter(|(start, _)| *start >= edge)
            .map(|(start, stop)| (start - edge, stop - edge))
            .collect();
        street.bridges.retain(|(start, _)| *start < edge);
        street.points = resample(&cut(&street.points, edge), VERTEX_STEP);
        street
            .widths
            .resize(street.points.len(), Class::Main.width(size));
        streets.push(road);
    }
}
/// Buildings, barns, numbers, wards and occupants for the placed plots.
fn finish(
    placed: Vec<(Slot, Use)>,
    size: Size,
    wards: Option<&Wards>,
    jitter: &mut Jitter,
) -> Vec<Plot> {
    let farm = size <= Size::Hamlet;
    let mut plots = placed
        .into_iter()
        .map(|(slot, use_)| {
            let base = use_.occupants(size);
            let occupants = if base > 0.0 {
                (base * jitter.around(1.0, 0.4)).round().max(1.0) as u32
            } else {
                0
            };
            let middle = add(slot.front, scale(slot.inward, slot.depth / 2.0));
            Plot {
                building: building(&slot, use_, size),
                barn: (farm && use_ == Use::House)
                    .then(|| barn(&slot, size))
                    .flatten(),
                ward: wards.map_or(0, |w| w.of(middle)),
                slot,
                use_,
                number: 0,
                occupants,
            }
        })
        .collect::<Vec<_>>();
    number(&mut plots);
    plots
}
fn number(plots: &mut [Plot]) {
    let streets = plots
        .iter()
        .map(|p| p.slot.street)
        .max()
        .map_or(0, |m| m + 1);
    for street in 0..streets {
        let on = (0..plots.len())
            .filter(|&i| plots[i].slot.street == street)
            .collect::<Vec<_>>();
        let entries = on
            .iter()
            .map(|&i| (plots[i].slot.along, plots[i].slot.side))
            .collect::<Vec<(f64, Side)>>();
        for (&i, n) in on.iter().zip(numbers(&entries)) {
            plots[i].number = n;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn seat(people: f64, arms: usize) -> Seat {
        let directions = [[1.0, 0.0], [-1.0, 0.0], [0.0, 1.0], [0.0, -1.0], [0.7, 0.7]];
        Seat {
            key: "test-seat".into(),
            name: "Test".into(),
            centre: [0.0, 0.0],
            story: Story {
                people,
                ways: arms,
                town_eras: 3,
                eras: 3,
                ..Story::default()
            },
            arms: directions[..arms]
                .iter()
                .map(|d| Arm {
                    points: vec![[0.0, 0.0], scale(*d, 1_400.0)],
                    destination: None,
                })
                .collect(),
            culture: None,
        }
    }
    #[test]
    fn a_village_is_laid_with_addressed_houses_on_its_streets() {
        let mut ground = Ground::new([-1_500.0, -1_500.0, 1_500.0, 1_500.0], 1.5);
        let plan = lay(seat(400.0, 2), &mut ground, None);
        assert_eq!(plan.size, Size::Village);
        assert!(plan.square.is_some());
        let houses = plan.plots.iter().filter(|p| p.use_ == Use::House).count();
        assert!(houses >= 60, "{houses} houses");
        assert!(plan.plots.iter().any(|p| p.use_ == Use::Temple));
        assert!(plan.plots.iter().all(|p| p.number > 0));
        for street in 0..plan.streets.len() {
            let mut numbers = plan
                .plots
                .iter()
                .filter(|p| p.slot.street == street)
                .map(|p| p.number)
                .collect::<Vec<_>>();
            numbers.sort_unstable();
            numbers.dedup();
            assert_eq!(
                numbers.len(),
                plan.plots
                    .iter()
                    .filter(|p| p.slot.street == street)
                    .count()
            );
        }
        assert!(plan.streets.iter().any(|s| s.class == Class::Road));
        assert!(plan.wards.is_none());
    }
    #[test]
    fn a_city_whose_ways_in_stop_short_grows_lanes_until_its_people_are_housed() {
        let mut ground = Ground::new([-2_500.0, -2_500.0, 2_500.0, 2_500.0], 2.0);
        let mut short = seat(20_000.0, 3);
        for arm in &mut short.arms {
            arm.points[1] = scale(unit(arm.points[1]), 200.0);
        }
        let plan = lay(short, &mut ground, Some(Layout::Organic));
        let housed: f64 = plan.plots.iter().map(|p| f64::from(p.occupants)).sum();
        assert!(housed >= 0.9 * 20_000.0, "{housed} of 20000 housed");
        assert_eq!(crossed(&plan), 0, "streets run through buildings");
    }
    #[test]
    fn people_a_full_site_cannot_house_are_counted_not_dropped() {
        let mut ground = Ground::new([-150.0, -150.0, 150.0, 150.0], 1.5);
        let plan = lay(seat(3_000.0, 2), &mut ground, Some(Layout::Organic));
        let homes = plan
            .plots
            .iter()
            .filter(|p| matches!(p.use_, Use::House | Use::Workshop(_)))
            .count();
        let needs = needs(&plan.seat.story, plan.layout);
        let housed: f64 = plan
            .plots
            .iter()
            .filter(|p| !matches!(p.use_, Use::House | Use::Workshop(_) | Use::Barn))
            .map(|p| p.use_.occupants(plan.size))
            .sum();
        let wanted = ordinary(&needs, housed).len();
        assert!(plan.unhoused > 0, "a 300 m site cannot house 3000 people");
        let left = f64::from(plan.unhoused) / household(plan.size);
        assert_eq!((homes as f64 + left).round() as usize, wanted);
    }
    #[test]
    fn people_of_a_special_building_with_no_place_live_in_ordinary_homes() {
        let mut ground = Ground::new([-1_500.0, -1_500.0, 1_500.0, 1_500.0], 1.5);
        let mut by_water = seat(400.0, 2);
        by_water.story.waterside = true;
        let plan = lay(by_water, &mut ground, None);
        assert!(
            !plan.plots.iter().any(|p| p.use_ == Use::Mill),
            "no water for a mill"
        );
        let needs = needs(&plan.seat.story, plan.layout);
        let all: f64 = special(&needs).iter().map(|u| u.occupants(plan.size)).sum();
        let built: f64 = plan
            .plots
            .iter()
            .filter(|p| !matches!(p.use_, Use::House | Use::Workshop(_) | Use::Barn))
            .map(|p| p.use_.occupants(plan.size))
            .sum();
        assert!(built < all);
        let homes = plan
            .plots
            .iter()
            .filter(|p| matches!(p.use_, Use::House | Use::Workshop(_)))
            .count();
        assert_eq!(homes, ordinary(&needs, built).len());
        assert!(homes > ordinary(&needs, all).len());
    }
    /// Streets whose line or edges pass through a building.
    fn crossed(plan: &Plan) -> usize {
        use crate::atlas::town::{
            geometry::{at, left},
            ground::{Rectangle, Shape},
        };
        let through = |street: &Street| {
            let mut along = 0.0;
            while along <= street.length() {
                let (p, d) = at(&street.points, along).unwrap();
                for side in [-0.5, 0.0, 0.5] {
                    let q = add(p, scale(left(d), side * street.width() * 0.95));
                    if plan
                        .plots
                        .iter()
                        .any(|plot| Rectangle(&plot.building).contains(q))
                    {
                        return true;
                    }
                }
                along += 0.5;
            }
            false
        };
        plan.streets.iter().filter(|s| through(s)).count()
    }
    #[test]
    fn a_town_has_wards_and_each_layout_houses_its_people() {
        for forced in [
            Layout::Organic,
            Layout::Grid,
            Layout::Radial,
            Layout::Walled,
            Layout::Linear,
        ] {
            let mut ground = Ground::new([-1_500.0, -1_500.0, 1_500.0, 1_500.0], 1.5);
            let plan = lay(seat(3_000.0, 4), &mut ground, Some(forced));
            assert_eq!(plan.layout, forced);
            let housed: f64 = plan.plots.iter().map(|p| f64::from(p.occupants)).sum();
            assert!(housed >= 0.9 * 3_000.0, "{forced:?}: {housed} housed");
            let wards = plan.wards.as_ref().unwrap();
            assert!(plan.plots.iter().all(|p| p.ward < wards.count()));
            assert_eq!(plan.wall.is_some(), forced == Layout::Walled);
        }
    }
}
