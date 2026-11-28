//! Chance for every generation layer: the one place a rule gets a draw, a noise field, a
//! weighted choice, a wandering walk or scattered points.
//!
//! Every piece here was taken out of a geology or river rule that already worked that
//! way and is still used by it: plate seeds and continental accretion, rock columns,
//! mountain sheets, fractures, coastal detail, finer-map relief, river routing, drainage
//! and carried river courses. A piece is added only with such a user.
//!
//! How chance is given here:
//!
//! - **Draws are named, not taken in turn.** A [`Chance`] is a map's seed and the purpose
//!   the draws serve; a draw is made for a thing, named by two numbers (a cell's
//!   position, a plate's number, a walker and how far it has gone). The same thing gets
//!   the same draw whatever order things are visited in, so a rule may run over cells in
//!   any order or many at once. There is no running generator to advance.
//! - **Chance is a quantity a rule weighs, not a switch.** A draw scales a cost, tilts a
//!   choice among options that fields have already weighed, bends a path or roughens a
//!   field. The fields decide what is likely; chance decides which likely thing happens
//!   here.
//! - **Form comes from many small steps.** A [`Walker`] takes one step at a time, a
//!   front takes its [`cheapest`] member at a time, a flood crosses [`Corridors`] cell
//!   by cell. What a rule draws on a map is what those steps leave behind.
//!
//! [`crate::noise`] holds the arithmetic beneath: the mixed hash and the value-noise
//! octaves. Rules use this module.
mod choice;
mod field;
mod scatter;
mod walk;

pub use choice::{best, cheapest, ticket};
pub use field::{ridged, Corridors, Noise, Warp};
pub use scatter::Scatter;
pub use walk::{Stride, Walker, Whims};

use crate::noise::{hash_signed, hash_unit};

/// The thing a draw is made for, named by two numbers: a position, a number and a turn,
/// a pair of neighbours.
pub type Key = [f64; 2];

/// A source of draws for one purpose on one map. A purpose is a number of the rule's
/// own, so two rules drawing for the same cell do not draw the same thing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Chance(i32);
impl Chance {
    pub const fn of(seed: i32, purpose: i32) -> Self {
        Self(seed ^ purpose)
    }
    /// A draw from nought up to one.
    pub fn unit(self, [a, b]: Key) -> f64 {
        hash_unit(self.0, a, b)
    }
    /// A draw from minus one up to one.
    pub fn signed(self, [a, b]: Key) -> f64 {
        hash_signed(self.0, a, b)
    }
    /// A draw from `low` up to `high`.
    pub fn between(self, key: Key, [low, high]: [f64; 2]) -> f64 {
        low + (high - low) * self.unit(key)
    }
    /// A draw from `base` up over `width`.
    pub fn spread(self, key: Key, base: f64, width: f64) -> f64 {
        base + self.unit(key) * width
    }
    /// A heading drawn from the whole circle, in radians.
    pub fn angle(self, key: Key) -> f64 {
        self.unit(key) * std::f64::consts::TAU
    }
    /// Whether a thing with these odds happens.
    pub fn happens(self, key: Key, odds: f64) -> bool {
        self.unit(key) < odds
    }
    /// One of `count` things, each as likely as the next.
    pub fn one_of(self, key: Key, count: usize) -> usize {
        ((self.unit(key) * count as f64).floor() as usize).min(count.saturating_sub(1))
    }
    /// The option chance favours. Each option draws for itself and the highest draw
    /// wins, the earliest among equals, so an option's own draw does not change when
    /// other options come or go.
    pub fn favoured<T>(
        self,
        options: impl IntoIterator<Item = T>,
        key: impl Fn(&T) -> Key,
    ) -> Option<T> {
        best(options, |option| self.unit(key(option)))
    }
    /// The things in the order chance ranks them, the most favoured first. `key` names
    /// each thing by its place in the list and itself.
    pub fn ranked<T>(
        self,
        things: impl IntoIterator<Item = T>,
        key: impl Fn(usize, &T) -> Key,
    ) -> Vec<T> {
        let mut drawn: Vec<_> = things
            .into_iter()
            .enumerate()
            .map(|(at, thing)| (self.unit(key(at, &thing)), thing))
            .collect();
        // hpc-exempt: a short list ranked once by its draws, keeping the first of equals first.
        drawn.sort_by(|a, b| b.0.total_cmp(&a.0));
        drawn.into_iter().map(|(_, thing)| thing).collect()
    }
    /// A many-scaled noise field of this purpose.
    pub const fn noise(self, scale: f64, octaves: usize) -> Noise {
        Noise::new(self, scale, octaves)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(count: usize) -> impl Iterator<Item = Key> {
        (0..count).map(|n| [n as f64, (n * 7 % 13) as f64])
    }

    #[test]
    fn a_thing_keeps_its_draw_and_other_things_and_purposes_draw_otherwise() {
        let chance = Chance::of(41, 0x1b73);
        assert_eq!(chance.unit([3., 9.]), chance.unit([3., 9.]));
        assert_ne!(chance.unit([3., 9.]), chance.unit([9., 3.]));
        assert_ne!(chance.unit([3., 9.]), Chance::of(41, 0x1b74).unit([3., 9.]));
        assert_ne!(chance.unit([3., 9.]), Chance::of(42, 0x1b73).unit([3., 9.]));
    }

    #[test]
    fn draws_cover_their_range_evenly() {
        let chance = Chance::of(7, 0x2222);
        let draws: Vec<_> = keys(20_000).map(|key| chance.unit(key)).collect();
        assert!(draws.iter().all(|draw| (0. ..1.).contains(draw)));
        let mean = draws.iter().sum::<f64>() / draws.len() as f64;
        assert!((mean - 0.5).abs() < 0.01, "{mean}");
        for tenth in 0..10 {
            let low = f64::from(tenth) / 10.;
            let share = draws
                .iter()
                .filter(|draw| (low..low + 0.1).contains(*draw))
                .count() as f64
                / draws.len() as f64;
            assert!((share - 0.1).abs() < 0.015, "tenth {tenth}: {share}");
        }
        assert!(keys(2_000).all(|key| (-1. ..1.).contains(&chance.signed(key))));
        assert!(keys(2_000).all(|key| (5. ..8.).contains(&chance.between(key, [5., 8.]))));
        assert!(keys(2_000).all(|key| (0.6..1.4).contains(&chance.spread(key, 0.6, 0.8))));
        assert!(keys(2_000).all(|key| (0. ..std::f64::consts::TAU).contains(&chance.angle(key))));
    }

    #[test]
    fn a_thing_happens_as_often_as_its_odds_and_each_of_many_is_as_likely() {
        let chance = Chance::of(7, 0x5a13);
        let happened = keys(20_000).filter(|key| chance.happens(*key, 0.3)).count() as f64;
        assert!((happened / 20_000. - 0.3).abs() < 0.02);
        assert!(keys(500).all(|key| !chance.happens(key, 0.)));
        let mut counts = [0usize; 4];
        for key in keys(20_000) {
            counts[chance.one_of(key, 4)] += 1;
        }
        assert!(
            counts.iter().all(|count| (4_500..5_500).contains(count)),
            "{counts:?}"
        );
        assert_eq!(chance.one_of([1., 1.], 1), 0);
    }

    #[test]
    fn the_favoured_option_changes_only_when_it_leaves() {
        // Each option draws for itself. Taking away an option that was not favoured
        // leaves the favoured one; taking away the favoured one hands on to another.
        let options = [10usize, 11, 12, 13, 14, 15];
        let name = |option: &usize| [*option as f64, 0.];
        let mut handed_on = 0;
        for purpose in 0..200 {
            let chance = Chance::of(3, purpose);
            let favoured = chance.favoured(options, name).unwrap();
            let other = options.into_iter().find(|o| *o != favoured).unwrap();
            let without_other = options.into_iter().filter(|o| *o != other);
            assert_eq!(chance.favoured(without_other, name), Some(favoured));
            let without_it = options.into_iter().filter(|o| *o != favoured);
            handed_on += usize::from(chance.favoured(without_it, name) != Some(favoured));
        }
        assert_eq!(handed_on, 200);
        // Across purposes every option is favoured about as often as any other.
        let mut wins = [0usize; 6];
        for purpose in 0..6_000 {
            wins[Chance::of(3, purpose).favoured(options, name).unwrap() - 10] += 1;
        }
        assert!(
            wins.iter().all(|won| (800..1_200).contains(won)),
            "{wins:?}"
        );
        assert_eq!(Chance::of(3, 1).favoured(Vec::<usize>::new(), name), None);
    }

    #[test]
    fn ranking_keeps_every_thing_and_orders_them_differently_for_each_purpose() {
        let things = [0usize, 1, 2, 3, 4, 5, 6, 7];
        let rank = |purpose| Chance::of(11, purpose).ranked(things, |at, _| [at as f64, 0.]);
        let first = rank(0x7143);
        let mut found = [false; 8];
        for thing in &first {
            found[*thing] = true;
        }
        assert!(found.iter().all(|found| *found));
        assert_eq!(first, rank(0x7143));
        let different = (1..40).filter(|purpose| rank(*purpose) != first).count();
        assert!(different >= 38, "{different}");
    }
}
