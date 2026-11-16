//! Plots fronting the streets, the building on each, and the fields beyond the built edge.
use super::{
    geometry::{add, at, distance, left, rectangle, scale, Point},
    ground::{Ground, Rectangle, FIELD, FIRST_STREET},
    network::{Class, Street},
    story::Size,
    uses::Use,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}
/// A place for a plot on one side of a street.
#[derive(Clone, Debug)]
pub struct Slot {
    pub street: usize,
    pub side: Side,
    pub along: f64,
    pub corners: Vec<Point>,
    /// The middle of the plot's street edge, the street's direction there and the way
    /// into the plot, away from the street.
    pub front: Point,
    pub direction: Point,
    pub inward: Point,
    pub frontage: f64,
    pub depth: f64,
}
/// Ground left between the street's edge and a plot.
const VERGE: f64 = 0.5;
/// Plots are drawn a little narrower than their pitch so neighbours only touch.
const PITCH_FILL: f64 = 0.98;
/// Frontage and depth of an ordinary plot in metres, by the size of the place.
pub fn plot_size(size: Size) -> (f64, f64) {
    match size {
        Size::Farmstead => (30.0, 40.0),
        Size::Hamlet => (20.0, 35.0),
        Size::Village => (14.0, 30.0),
        Size::Town => (8.0, 24.0),
        Size::City => (6.0, 20.0),
    }
}
/// Every plot place along both sides of a street, from its start.
pub fn slots(index: usize, street: &Street, frontage: f64, depth: f64) -> Vec<Slot> {
    let length = street.length();
    let mut result = Vec::new();
    for side in [Side::Left, Side::Right] {
        let sign = if side == Side::Left { 1.0 } else { -1.0 };
        let mut along = street.width().max(frontage) / 2.0;
        while along + frontage / 2.0 <= length {
            if let Some((p, d)) = at(&street.points, along) {
                let inward = scale(left(d), sign);
                let front = add(p, scale(inward, street.width() / 2.0 + VERGE));
                result.push(Slot {
                    street: index,
                    side,
                    along,
                    corners: rectangle(front, d, inward, frontage * PITCH_FILL, depth),
                    front,
                    direction: d,
                    inward,
                    frontage,
                    depth,
                });
            }
            along += frontage;
        }
    }
    result
}
/// Takes plots in order of `key`, each only where the ground is open, until `wanted` are taken.
pub fn take(
    slots: Vec<Slot>,
    ground: &mut Ground,
    owner: u32,
    wanted: usize,
    key: impl Fn(&Slot) -> f64,
) -> Vec<Slot> {
    let keyed = slots.into_iter().map(|s| (key(&s), s)).collect();
    take_keyed(keyed, ground, owner, wanted)
}
/// Takes plots in rising order of their keys, each only where the ground is open.
pub fn take_keyed(
    mut keyed: Vec<(f64, Slot)>,
    ground: &mut Ground,
    owner: u32,
    wanted: usize,
) -> Vec<Slot> {
    // hpc-exempt: orders candidate plots by how strongly the place wants each one.
    keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut taken = Vec::new();
    for (_, slot) in keyed {
        if taken.len() >= wanted {
            break;
        }
        let street = FIRST_STREET + slot.street as u32;
        if ground.open(&Rectangle(&slot.corners), street) {
            ground.take(&Rectangle(&slot.corners), owner);
            taken.push(slot);
        }
    }
    taken
}
/// How near the centre a place grows first: along its main streets before its lanes.
pub fn growth(centre: Point, streets: &[Street]) -> impl Fn(&Slot) -> f64 + '_ {
    move |slot| {
        let main = streets[slot.street].class == Class::Main;
        distance(slot.front, centre) * if main { 0.85 } else { 1.0 }
    }
}
fn setback(size: Size) -> f64 {
    match size {
        Size::City | Size::Town => 0.3,
        Size::Village => 2.0,
        Size::Hamlet | Size::Farmstead => 4.0,
    }
}
fn fill(size: Size) -> f64 {
    match size {
        Size::City | Size::Town => 0.96,
        Size::Village => 0.7,
        Size::Hamlet => 0.55,
        Size::Farmstead => 0.5,
    }
}
/// The building on a plot, at its street edge and turned to the street.
pub fn building(slot: &Slot, use_: Use, size: Size) -> Vec<Point> {
    let (wide, deep) = use_.footprint(size);
    let width = wide.min(slot.frontage * fill(size));
    let depth = deep.min(slot.depth * 0.8);
    let front = add(slot.front, scale(slot.inward, setback(size)));
    rectangle(front, slot.direction, slot.inward, width, depth)
}
/// A barn behind a farmhouse, where the plot is deep enough for one.
pub fn barn(slot: &Slot, size: Size) -> Option<Vec<Point>> {
    let (_, house) = Use::House.footprint(size);
    let (wide, deep) = Use::Barn.footprint(size);
    let behind = setback(size) + house + 4.0;
    let depth = deep.min(slot.depth - behind - 1.0);
    (depth >= 6.0).then(|| {
        rectangle(
            add(slot.front, scale(slot.inward, behind)),
            slot.direction,
            slot.inward,
            wide.min(slot.frontage * 0.5),
            depth,
        )
    })
}
/// A field and what it grows.
pub struct Field {
    pub corners: Vec<Point>,
    pub pasture: bool,
}
/// The country around the built places: where they stand, how far they are built and how the
/// fields are pitched.
pub struct Country<'a> {
    pub places: &'a [(Point, f64)],
    pub axis: Point,
    pub bounds: [f64; 4],
    pub width: f64,
    pub depth: f64,
}
const BALK: f64 = 4.0;
/// Fields in blocks around the built places, nearest first, until `target` square metres are
/// farmed; `share` gives the farmland and pasture shares at a point.
pub fn fields(
    country: &Country<'_>,
    ground: &mut Ground,
    target: f64,
    share: impl Fn(Point) -> (f64, f64),
) -> Vec<Field> {
    let across = left(country.axis);
    let area = country.width * country.depth;
    let mut farmed = 0.0;
    let mut result = Vec::new();
    for (_, middle) in blocks(country) {
        if farmed >= target {
            break;
        }
        let (farm, pasture) = share(middle);
        if farm + pasture <= 0.0 {
            continue;
        }
        let front = add(middle, scale(across, -country.depth / 2.0));
        let corners = rectangle(front, country.axis, across, country.width, country.depth);
        if ground.open(&Rectangle(&corners), u32::MAX) {
            ground.take(&Rectangle(&corners), FIELD);
            farmed += area;
            result.push(Field {
                corners,
                pasture: pasture > farm,
            });
        }
    }
    result
}
/// Middles of field blocks on the map beyond the built edges, nearest an edge first.
fn blocks(country: &Country<'_>) -> Vec<(f64, Point)> {
    let Some(&(origin, _)) = country.places.first() else {
        return Vec::new();
    };
    let [w, s, e, n] = country.bounds;
    let reach = (e - w).hypot(n - s);
    let (step_a, step_b) = (country.width + BALK, country.depth + BALK);
    let across = left(country.axis);
    let mut candidates = Vec::new();
    let (ia, ib) = (
        (reach / step_a).ceil() as i64,
        (reach / step_b).ceil() as i64,
    );
    for i in -ia..=ia {
        for j in -ib..=ib {
            let middle = add(
                origin,
                add(
                    scale(country.axis, i as f64 * step_a),
                    scale(across, j as f64 * step_b),
                ),
            );
            if !(w..=e).contains(&middle[0]) || !(s..=n).contains(&middle[1]) {
                continue;
            }
            let near = country
                .places
                .iter()
                .map(|&(p, built)| distance(p, middle) - built)
                .fold(f64::INFINITY, f64::min);
            if near > country.depth / 2.0 {
                candidates.push((near, middle));
            }
        }
    }
    // hpc-exempt: orders field blocks outward from the built edge.
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atlas::town::{geometry::resample, ground::PLOT};
    fn street() -> Street {
        Street::new(
            resample(&[[0.0, 0.0], [100.0, 0.0]], 10.0),
            Class::Main,
            Size::Town,
        )
    }
    #[test]
    fn slots_front_both_sides_of_a_street_and_are_taken_without_overlap() {
        let street = street();
        let all = slots(0, &street, 8.0, 24.0);
        let left = all.iter().filter(|s| s.side == Side::Left).count();
        assert_eq!(left, all.len() - left);
        assert_eq!(left, 12);
        assert!(all
            .iter()
            .all(|s| (s.front[1].abs() - (4.0 + VERGE)).abs() < 1e-9));
        let mut ground = Ground::new([-10.0, -50.0, 110.0, 50.0], 1.5);
        ground.take_line(&street.points, street.width(), FIRST_STREET);
        let first = take(all.clone(), &mut ground, PLOT, 100, |s| s.along);
        assert_eq!(first.len(), all.len());
        assert!(take(all, &mut ground, PLOT, 100, |s| s.along).is_empty());
    }
    #[test]
    fn buildings_stand_at_the_street_edge_of_their_plot() {
        let slot = slots(0, &street(), 8.0, 24.0).remove(0);
        let house = building(&slot, Use::House, Size::Town);
        let nearest = house.iter().map(|p| p[1].abs()).fold(f64::MAX, f64::min);
        assert!((nearest - (4.0 + VERGE + 0.3)).abs() < 1e-9);
        let temple = building(&slot, Use::Temple, Size::Town);
        let deepest = temple.iter().map(|p| p[1].abs()).fold(0.0, f64::max);
        assert!(deepest <= 4.0 + VERGE + 24.0);
        let farm = slots(0, &street(), 30.0, 40.0).remove(0);
        assert!(barn(&farm, Size::Farmstead).is_some());
        let shallow = slots(0, &street(), 6.0, 20.0).remove(0);
        assert!(barn(&shallow, Size::City).is_none());
    }
    #[test]
    fn fields_fill_outward_from_the_built_edge_until_the_farmland_is_met() {
        let mut ground = Ground::new([0.0, 0.0, 1_000.0, 1_000.0], 5.0);
        let country = Country {
            places: &[([500.0, 500.0], 100.0)],
            axis: [1.0, 0.0],
            bounds: [0.0, 0.0, 1_000.0, 1_000.0],
            width: 60.0,
            depth: 150.0,
        };
        let fields = fields(&country, &mut ground, 60.0 * 150.0 * 10.0, |p| {
            (1.0, if p[0] < 500.0 { 2.0 } else { 0.0 })
        });
        assert_eq!(fields.len(), 10);
        assert!(fields.iter().any(|f| f.pasture) && fields.iter().any(|f| !f.pasture));
        for field in &fields {
            let middle = scale(add(field.corners[0], field.corners[2]), 0.5);
            assert!(distance(middle, [500.0, 500.0]) > 100.0);
        }
    }
}
