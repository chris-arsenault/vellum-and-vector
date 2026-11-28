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
//!
//! # What to reach for
//!
//! | The rule needs | Reach for | Not |
//! |---|---|---|
//! | one of several weighed options | [`ticket`], [`Chance::weighted`], [`order`] | the best one, always |
//! | the next piece of something growing | [`cheapest`] or [`best`] with chance in the score | a fixed order |
//! | a thing to spread over ground | [`Front::arrivals`], then take what has arrived by now | a contour at a level |
//! | a quantity to soak outward unevenly | [`seep`] through [`Corridors`] or [`Patches`] | an even blur |
//! | a line, edge or course | a [`Walker`] that steps and drifts, or [`wandering`] | a straight run or a smooth outline |
//! | a share of ground lost, taken or covered | [`Patches::covers`] | the same share of every cell |
//! | the same, changing from round to round | [`Patches::rank_at`], [`Noise::drifting`] | a fresh draw each round |
//! | ground that differs from place to place | [`Noise`], [`Warp`], [`ridged`] | one value everywhere |
//! | places to begin from | [`Scatter::spaced`], [`Scatter::position`] | a grid or the centre |
//! | a size, a length, a wait, a strength | [`Chance::between`], [`Chance::bell`], [`Chance::long_tail`], [`Chance::wait`] | one fixed figure |
//! | a level that rises and falls over eras | [`Chance::wander`] | a table of eras |
//! | a draw of a town's, a river's, a realm's own | [`Chance::about`] its identity | one draw for all of them |
//! | a purpose for a new rule's draws | [`Chance::named`], [`Chance::nth`] | an invented number |
//!
//! `chance/examples.rs` grows a town wall from these pieces in about a hundred lines:
//! builders walk round the town laying wall, stretches fall in patches, and later
//! builders follow what stands. It is the pattern for a rule and for the check that
//! proves a rule's results differ from seed to seed and collapse to one when chance is
//! taken away. To see every piece drawn, run
//! `cargo +stable test -p atlas-generation --lib gallery_of_chance -- --ignored --nocapture`.
mod choice;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod examples;
mod field;
mod line;
mod scatter;
mod spread;
mod walk;

pub use choice::{best, cheapest, order, ticket};
pub use field::{ridged, Corridors, Noise, Patches, Warp};
pub use line::wandering;
pub use scatter::Scatter;
pub use spread::{seep, Front};
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
    /// A source of draws for a purpose given by name, such as `"city.wall.builders"`.
    /// A new rule names its purposes instead of inventing numbers for them.
    pub const fn named(seed: i32, purpose: &str) -> Self {
        let bytes = purpose.as_bytes();
        let mut mixed = 0x811c_9dc5u32;
        let mut at = 0;
        while at < bytes.len() {
            mixed = (mixed ^ bytes[at] as u32).wrapping_mul(0x0100_0193);
            at += 1;
        }
        Self(seed ^ mixed as i32)
    }
    /// The same purpose for one named thing known by its identity, such as a settlement
    /// or a river: what is drawn for it is its own, whatever map it is drawn on.
    pub const fn about(self, identity: &[u8]) -> Self {
        let mut mixed = 0x811c_9dc5u32;
        let mut at = 0;
        while at < identity.len() {
            mixed = (mixed ^ identity[at] as u32).wrapping_mul(0x0100_0193);
            at += 1;
        }
        Self(self.0 ^ (mixed as i32).wrapping_mul(0x2545_f491))
    }
    /// The same purpose for the `number`th of something: a round, a walker, a wall.
    pub const fn nth(self, number: i32) -> Self {
        Self(self.0 ^ number.wrapping_mul(0x9e37).wrapping_add(0x5bd1))
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
    /// The option chance favours among weighted options. Each option draws for itself,
    /// so one twice the weight wins twice as often, and weighing another option changes
    /// no option's own draw.
    pub fn weighted<T>(
        self,
        options: impl IntoIterator<Item = T>,
        key: impl Fn(&T) -> Key,
        weight: impl Fn(&T) -> f64,
    ) -> Option<T> {
        best(options, |option| {
            order(weight(option), self.unit(key(option)))
        })
    }
    /// How long a thing takes that happens at `rate`: short most often and long now and
    /// then, about one over the rate on average.
    pub fn wait(self, key: Key, rate: f64) -> f64 {
        -(1.0 - self.unit(key)).ln() / rate
    }
    /// A draw gathered about nought as measured things are: two in three within one
    /// either way, one in twenty beyond two.
    pub fn bell(self, key: Key) -> f64 {
        let reach = (-2.0 * (1.0 - self.unit(key)).ln()).sqrt();
        reach * (self.nth(1).unit(key) * std::f64::consts::TAU).cos()
    }
    /// A size from one upward with a long tail: most barely above one, a few many times
    /// it. A smaller `tail` makes the few larger: at one, one in a hundred passes a
    /// hundred; at three, one in a hundred passes about five.
    pub fn long_tail(self, key: Key, tail: f64) -> f64 {
        (1.0 - self.unit(key)).powf(-1.0 / tail)
    }
    /// Where a level stands after wandering for `turns` turns from nought: each turn it
    /// moves by up to one either way, and is drawn back toward nought by the share
    /// `home` of how far it has strayed. With no pull home it strays ever further; with
    /// a pull it rises and falls about nought. The turns before are the same turns, so a
    /// rule may ask for any turn in any order.
    pub fn wander(self, key: Key, turns: usize, home: f64) -> f64 {
        (0..turns).fold(0.0, |level, turn| {
            level * (1.0 - home) + self.nth(turn as i32).signed(key)
        })
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
    fn a_purpose_by_name_is_its_own_and_so_is_each_nth_of_it() {
        let builders = Chance::named(9, "city.wall.builders");
        assert_eq!(builders, Chance::named(9, "city.wall.builders"));
        assert_ne!(builders, Chance::named(9, "city.wall.wear"));
        assert_ne!(builders, Chance::named(10, "city.wall.builders"));
        assert_ne!(builders.nth(1), builders.nth(2));
        assert_ne!(builders.nth(0), builders);
        // One town's draws are not another's.
        assert_eq!(builders.about(b"Mitsu"), builders.about(b"Mitsu"));
        assert_ne!(builders.about(b"Mitsu"), builders.about(b"Vila"));
        assert_ne!(builders.about(b"Mitsu"), builders);
        // Two names draw unrelated things for the same key.
        let wear = Chance::named(9, "city.wall.wear");
        let alike = keys(4_000)
            .filter(|key| (builders.unit(*key) - wear.unit(*key)).abs() < 0.01)
            .count();
        assert!(alike < 160, "{alike}");
    }

    #[test]
    fn waits_are_mostly_short() {
        let chance = Chance::named(7, "test.shapes");
        let share = |held: usize| held as f64 / 20_000.;
        // A thing that happens twice a unit of time waits half a unit on average, and
        // most waits are shorter than that.
        let waits: Vec<_> = keys(20_000).map(|key| chance.wait(key, 2.)).collect();
        assert!(waits.iter().all(|wait| *wait >= 0.));
        let mean = waits.iter().sum::<f64>() / 20_000.;
        assert!((mean - 0.5).abs() < 0.02, "{mean}");
        let short = share(waits.iter().filter(|wait| **wait < 0.5).count());
        assert!((short - 0.632).abs() < 0.02, "{short}");
    }

    #[test]
    fn bells_gather_about_nought() {
        let chance = Chance::named(7, "test.shapes");
        let share = |held: usize| held as f64 / 20_000.;
        // A bell: about nought, two in three within one, one in twenty beyond two.
        let bells: Vec<_> = keys(20_000).map(|key| chance.bell(key)).collect();
        let middle = bells.iter().sum::<f64>() / 20_000.;
        assert!(middle.abs() < 0.03, "{middle}");
        let within = share(bells.iter().filter(|bell| bell.abs() < 1.).count());
        let beyond = share(bells.iter().filter(|bell| bell.abs() > 2.).count());
        assert!((within - 0.683).abs() < 0.02, "{within}");
        assert!((beyond - 0.046).abs() < 0.012, "{beyond}");
    }

    #[test]
    fn long_tails_have_a_few_giants() {
        let chance = Chance::named(7, "test.shapes");
        let share = |held: usize| held as f64 / 20_000.;
        // A long tail: never under one, half under two, one in a hundred past a hundred.
        let sizes: Vec<_> = keys(20_000).map(|key| chance.long_tail(key, 1.)).collect();
        assert!(sizes.iter().all(|size| *size >= 1.));
        let small = share(sizes.iter().filter(|size| **size < 2.).count());
        let giant = share(sizes.iter().filter(|size| **size > 100.).count());
        assert!((small - 0.5).abs() < 0.02, "{small}");
        assert!((0.005..0.016).contains(&giant), "{giant}");
        // A thinner tail has far fewer giants.
        let thin = share(
            keys(20_000)
                .filter(|key| chance.long_tail(*key, 3.) > 100.)
                .count(),
        );
        assert!(thin < 0.001, "{thin}");
    }

    #[test]
    fn a_wandering_level_strays_without_a_pull_home_and_keeps_near_with_one() {
        let chance = Chance::named(7, "test.wander");
        let strayed = |home: f64| {
            keys(400)
                .map(|key| chance.wander(key, 64, home).abs())
                .sum::<f64>()
                / 400.
        };
        let (free, held) = (strayed(0.), strayed(0.3));
        assert!(free > 3. * held, "{free} {held}");
        assert!(held > 0.3, "{held}");
        // A turn moves the level by no more than one, and the turns before it are the
        // same turns whenever they are asked for.
        for key in keys(200) {
            let step = chance.wander(key, 10, 0.) - chance.wander(key, 9, 0.);
            assert!(step.abs() <= 1.);
        }
        assert_eq!(chance.wander([1., 2.], 0, 0.3), 0.);
    }

    #[test]
    fn a_weighted_option_is_favoured_in_proportion_to_its_weight() {
        let options = [(0usize, 1.), (1, 0.), (2, 3.), (3, 6.)];
        let mut wins = [0usize; 4];
        for purpose in 0..10_000 {
            let won = Chance::of(5, purpose)
                .weighted(options, |o| [o.0 as f64, 0.], |o| o.1)
                .unwrap();
            wins[won.0] += 1;
        }
        let share = |at: usize| wins[at] as f64 / 10_000.;
        assert!((share(0) - 0.1).abs() < 0.02, "{wins:?}");
        assert_eq!(wins[1], 0);
        assert!((share(2) - 0.3).abs() < 0.03, "{wins:?}");
        assert!((share(3) - 0.6).abs() < 0.03, "{wins:?}");
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
