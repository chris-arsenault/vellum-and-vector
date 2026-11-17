//! Plots fronting the streets and the building on each.
use super::{
    geometry::{add, at, distance, dot, left, rectangle, scale, Point},
    ground::{Ground, Rectangle, FIRST_STREET},
    network::{Class, Street},
    story::Size,
    uses::Use,
};
use atlas_map::town::{fitted, setback, VERGE};
pub use atlas_map::town::{plot_size, Side};

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
use super::settings::{
    BUILDING_ENVELOPE_MIN, DEPTH_VARIATION, FRONTAGE_VARIATION, MAIN_STREET_PULL, PITCH_FILL,
};
/// Every plot place along both sides of a street, from its start.
pub fn slots(index: usize, street: &Street, frontage: f64, depth: f64) -> Vec<Slot> {
    let length = street.length();
    let mut result = Vec::new();
    for side in [Side::Left, Side::Right] {
        let sign = if side == Side::Left { 1.0 } else { -1.0 };
        let mut cursor = (street.width() - frontage).max(0.0) / 2.0;
        let mut ordinal = 0;
        while cursor < length {
            let sample = |salt| {
                crate::noise::hash_unit(
                    index as i32 ^ salt,
                    street.points[0][0] + ordinal as f64,
                    street.points[0][1] + sign,
                )
            };
            let pitch = frontage * (1.0 + FRONTAGE_VARIATION * (2.0 * sample(0x5711) - 1.0));
            let parcel_depth = depth * (1.0 + DEPTH_VARIATION * (2.0 * sample(0x2d31) - 1.0));
            if cursor + pitch > length {
                break;
            }
            let along = cursor + pitch / 2.0;
            let straight_front = at(&street.points, cursor)
                .zip(at(&street.points, cursor + pitch))
                .is_some_and(|((_, a), (_, b))| dot(a, b) >= 1.0 - 1e-9);
            if let Some((p, d)) = at(&street.points, along).filter(|_| straight_front) {
                let inward = scale(left(d), sign);
                let front = add(p, scale(inward, street.width() / 2.0 + VERGE));
                result.push(Slot {
                    street: index,
                    side,
                    along,
                    corners: rectangle(front, d, inward, pitch * PITCH_FILL, parcel_depth),
                    front,
                    direction: d,
                    inward,
                    frontage: pitch,
                    depth: parcel_depth,
                });
            }
            cursor += pitch;
            ordinal += 1;
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
        distance(slot.front, centre) * if main { MAIN_STREET_PULL } else { 1.0 }
    }
}
/// The building on a plot, at its street edge and turned to the street.
pub fn building(slot: &Slot, use_: Use, size: Size) -> Vec<Point> {
    let (width, depth) = fitted(use_, size, slot.frontage, slot.depth);
    let fit = |salt| {
        BUILDING_ENVELOPE_MIN
            + (1.0 - BUILDING_ENVELOPE_MIN)
                * crate::noise::hash_unit(salt, slot.front[0], slot.front[1])
    };
    let front = add(slot.front, scale(slot.inward, setback(size)));
    rectangle(
        front,
        slot.direction,
        slot.inward,
        width * fit(0x1921),
        depth * fit(0x5123),
    )
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
        assert!(left > 0 && left < all.len());
        assert!(all.windows(2).any(|s| s[0].frontage != s[1].frontage));
        assert!(all.windows(2).any(|s| s[0].depth != s[1].depth));
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
        assert!(deepest <= 4.0 + VERGE + slot.depth);
        let farm = slots(0, &street(), 30.0, 40.0).remove(0);
        assert!(barn(&farm, Size::Farmstead).is_some());
        let shallow = slots(0, &street(), 6.0, 20.0).remove(0);
        assert!(barn(&shallow, Size::City).is_none());
    }
}
