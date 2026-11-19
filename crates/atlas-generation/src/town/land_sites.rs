//! Unclaimed land within reach of inhabited sites. The sample partition gives each
//! piece of ground one opportunity even when several neighbours could settle it.
use super::{
    geometry::{distance, heading, left, rectangle, Point},
    plots::{Side, Slot},
};
use crate::noise::hash_unit;

pub fn around(
    anchors: impl IntoIterator<Item = Point>,
    reach: f64,
    frontage: f64,
    depth: f64,
    round: u32,
) -> Vec<Slot> {
    let spacing = (frontage * depth).sqrt();
    let salt = (round as i32).wrapping_mul(31);
    // hpc-exempt: occupied parcels share candidate land by its measured survey patch.
    let mut patches = std::collections::BTreeMap::new();
    for p in anchors {
        let bounds = |v: f64| {
            ((v - reach) / spacing).floor() as i64..=((v + reach) / spacing).floor() as i64
        };
        for x in bounds(p[0]) {
            for y in bounds(p[1]) {
                let sample = |s| hash_unit(salt ^ s, x as f64, y as f64);
                let front = [
                    (x as f64 + sample(121)) * spacing,
                    (y as f64 + sample(401)) * spacing,
                ];
                if distance(p, front) > reach {
                    continue;
                }
                patches.entry((x, y)).or_insert_with(|| {
                    let direction = heading(sample(617) * std::f64::consts::TAU);
                    let inward = left(direction);
                    Slot {
                        habitat: super::templates::Habitat::Ground,
                        tenure: super::templates::Tenure::Household,
                        street: None,
                        participant: None,
                        side: Side::Left,
                        along: 0.,
                        corners: rectangle(front, direction, inward, frontage, depth),
                        front,
                        direction,
                        inward,
                        frontage,
                        depth,
                    }
                });
            }
        }
    }
    patches.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn land_near_separate_occupations_can_offer_sites_without_frontage() {
        let sites = around([[0., 0.], [160., 0.]], 40., 9., 25., 2);
        assert!(sites.iter().any(|s| distance(s.front, [0., 0.]) < 40.));
        assert!(sites.iter().any(|s| distance(s.front, [160., 0.]) < 40.));
        assert!(sites
            .iter()
            .all(|s| s.street.is_none() && s.participant.is_none()));
        assert!(sites.iter().all(|s| distance(s.front, [80., 0.]) > 30.));
    }
}
