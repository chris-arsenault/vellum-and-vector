//! How a town is ordered. The causes that vary a town write these terms, and the rules
//! that build it (street laying, crossings, plot survey, household means, business bids)
//! read them, each as one part of a rule inside the rounds. Two causes write today: the
//! map's settings, and the settlement's civic order over them. Each term is a declared
//! setting. Most start at the value every town had before the term existed; the
//! template's character, the clustering of trades and a town's signature trades start
//! above it, so those loops act in every town.
//!
//! Lengths are street metres, resolved through the town's scale where they are read.
use crate::parameters::NumericParameter;
use crate::processes::strategies::MapType;
use serde::{Deserialize, Serialize};
use std::io;

/// A term with its default and the least value a map may give it. A plot or a spacing of
/// no size would never let a survey step forward, so lengths have a least size.
const fn term(
    name: &'static str,
    unit: &'static str,
    [default, least]: [f64; 2],
) -> NumericParameter {
    NumericParameter {
        name,
        unit,
        default,
        minimum: Some(least),
        maximum: None,
        strategy: None,
        map_types: &[MapType::Street],
    }
}
const STREET_SPACING: NumericParameter = term("streetSpacing", "street metres", [60., 5.]);
const BACK_LANE: NumericParameter = term("backLaneReach", "street metres", [20., 1.]);
const CROSSING_SPACING: NumericParameter = term("crossingSpacing", "plot depths", [5., 1.]);
const SHORTCUT_SAVING: NumericParameter = NumericParameter {
    maximum: Some(1.),
    ..term("shortcutSaving", "share of the walk", [0.4, 0.])
};
const STREET_WORK: NumericParameter = term("streetWorkShare", "effort per resident", [0.12, 0.]);
const PLOT_FRONTAGE: NumericParameter = term("plotFrontage", "street metres", [9., 2.]);
const PLOT_DEPTH: NumericParameter = term("plotDepth", "street metres", [25., 4.]);
const WEALTH_SPREAD: NumericParameter = term("wealthSpread", "relative spread", [1., 0.]);
const BIRTHRIGHT: NumericParameter = term("birthright", "weight", [1., 0.]);
const DEFERENCE: NumericParameter = term("deference", "weight", [1., 0.]);
const SURVEY: NumericParameter = term("survey", "weight", [1., 0.]);
const WORN: NumericParameter = term("wornWays", "weight", [1., 0.]);
const MARKET: NumericParameter = term("marketFrontage", "exponent", [1., 0.]);
// Starting values for these three, to be tuned once every process change is written.
const CHARACTER: NumericParameter = term("character", "exponent", [2., 0.]);
const CLUSTERING: NumericParameter = term("clustering", "weight", [0.5, 0.]);
const SATIETY: NumericParameter = term("satiety", "exponent", [1., 0.]);
const SIGNATURE: NumericParameter = term("signature", "weight", [3., 0.]);
pub const CONTROLS: &[NumericParameter] = &[
    STREET_SPACING,
    BACK_LANE,
    CROSSING_SPACING,
    SHORTCUT_SAVING,
    STREET_WORK,
    PLOT_FRONTAGE,
    PLOT_DEPTH,
    WEALTH_SPREAD,
    BIRTHRIGHT,
    DEFERENCE,
    SURVEY,
    WORN,
    MARKET,
    CHARACTER,
    CLUSTERING,
    SATIETY,
    SIGNATURE,
];

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Order {
    /// The least spacing a new route keeps from the streets it does not join.
    pub street_spacing: f64,
    /// How far behind a deep plot a back lane runs.
    pub back_lane: f64,
    /// The spacing of a main street's major crossings, in plot depths.
    pub crossing_spacing: f64,
    /// The share of a walk a shortcut must save before two street ends are joined.
    pub shortcut_saving: f64,
    /// The street work each participating resident supplies in a round.
    pub street_work: f64,
    /// The frontage and depth of the plots offered on open frontage each round.
    pub plot_frontage: f64,
    pub plot_depth: f64,
    /// How far apart the lots households are born to lie. At one a household's lot is as
    /// likely to be any share of the best; below one lots draw in toward the middle; above
    /// one most are born to little and a few to much.
    pub wealth_spread: f64,
    /// How much the lot a household is born to counts beside what its work brings in.
    pub birthright: f64,
    /// How strongly the standing of the places round a household lifts its own means, so
    /// that standing draws standing.
    pub deference: f64,
    /// How strongly a town lays frontage streets ahead of building, along its own bearings
    /// and in longer runs. Such streets still compete with every other street work for
    /// the same effort.
    pub survey: f64,
    /// How much a way worn by walking is worth surfacing beside other street work.
    pub worn: f64,
    /// How far trade keeps to busy frontage. At one a business weighs passing traffic as
    /// its kind always has; above one businesses crowd the busy streets and leave the
    /// quiet ones to homes; below one they spread among the homes.
    pub market: f64,
    /// How strongly a settlement's template shows in what takes each site.
    pub character: f64,
    /// How much premises of one family draw more of that family to their street.
    pub clustering: f64,
    /// How strongly the premises of a family a town already has deter more of it.
    pub satiety: f64,
    /// How much more a town's own signature trades bid than the rest.
    pub signature: f64,
}
impl Default for Order {
    fn default() -> Self {
        Self {
            street_spacing: STREET_SPACING.default,
            back_lane: BACK_LANE.default,
            crossing_spacing: CROSSING_SPACING.default,
            shortcut_saving: SHORTCUT_SAVING.default,
            street_work: STREET_WORK.default,
            plot_frontage: PLOT_FRONTAGE.default,
            plot_depth: PLOT_DEPTH.default,
            wealth_spread: WEALTH_SPREAD.default,
            birthright: BIRTHRIGHT.default,
            deference: DEFERENCE.default,
            survey: SURVEY.default,
            worn: WORN.default,
            market: MARKET.default,
            character: CHARACTER.default,
            clustering: CLUSTERING.default,
            satiety: SATIETY.default,
            signature: SIGNATURE.default,
        }
    }
}
impl Order {
    /// The lot a household is born to, from an even draw between nothing and the best.
    pub fn lot(&self, draw: f64) -> f64 {
        if self.wealth_spread <= 1. {
            0.5 + (draw - 0.5) * self.wealth_spread
        } else {
            draw.powf(self.wealth_spread)
        }
    }
    /// A household's means: the lot it was born to, set beside what its work brings in.
    /// `patronage` is the means of the places round the site, summed: among many who have
    /// much, birth counts for more, as it always has.
    pub fn means(&self, draw: f64, patronage: f64, working_income: f64) -> f64 {
        let lot = self.lot(draw);
        let standing = patronage * self.deference;
        let patron = standing / (1. + standing);
        let birth = self.birthright * (1. + patron);
        (lot * birth + working_income) / (1. + birth)
    }
    /// The share of a town's households that settle by standing: none where an order
    /// defers no more than usual, most where it defers greatly.
    pub fn settled_by_standing(&self) -> f64 {
        let beyond = (self.deference - 1.).max(0.);
        beyond / (1. + beyond)
    }
    /// The draw a site's household takes its lot from. Most households come where chance
    /// brings them and keep their `own` draw. The share an order settles by standing,
    /// picked by `chance`, take the `rank` their site holds among the town's open sites:
    /// the better born go to the places held in highest regard and the worst born are left
    /// the places held in least, so one early great house can make a great street and a
    /// common one beside it. Every lot is still drawn as often as before; only where it
    /// lands changes.
    pub fn settled_draw(&self, [own, chance]: [f64; 2], rank: f64) -> f64 {
        if chance < self.settled_by_standing() {
            rank
        } else {
            own
        }
    }
    /// The order a map's settings give before any cause writes to it.
    pub fn from_input(input: &crate::atlas::dispatch::Input) -> io::Result<Self> {
        Ok(Self {
            street_spacing: input.number(STREET_SPACING.name)?,
            back_lane: input.number(BACK_LANE.name)?,
            crossing_spacing: input.number(CROSSING_SPACING.name)?,
            shortcut_saving: input.number(SHORTCUT_SAVING.name)?,
            street_work: input.number(STREET_WORK.name)?,
            plot_frontage: input.number(PLOT_FRONTAGE.name)?,
            plot_depth: input.number(PLOT_DEPTH.name)?,
            wealth_spread: input.number(WEALTH_SPREAD.name)?,
            birthright: input.number(BIRTHRIGHT.name)?,
            deference: input.number(DEFERENCE.name)?,
            survey: input.number(SURVEY.name)?,
            worn: input.number(WORN.name)?,
            market: input.number(MARKET.name)?,
            character: input.number(CHARACTER.name)?,
            clustering: input.number(CLUSTERING.name)?,
            satiety: input.number(SATIETY.name)?,
            signature: input.number(SIGNATURE.name)?,
        })
    }
    /// What busy frontage is worth to a business beside what its kind already sees in it.
    pub fn trade_pull(&self, traffic: f64) -> f64 {
        (1. + traffic.max(0.)).powf(self.market - 1.)
    }
    /// A template's favour for an activity at a site, as strongly as the town shows it.
    pub fn favour(&self, affinity: f64) -> f64 {
        affinity.max(0.).powf(self.character)
    }
    /// What it costs a family of premises to add one more: dearer by how many the town
    /// already has, cheaper by how many stand on the same street.
    pub fn crowding(&self, in_town: f64, on_street: f64) -> f64 {
        (1. + in_town.max(0.)).powf(self.satiety) / (1. + self.clustering * on_street.max(0.))
    }
    /// How far a new frontage street turns from the way its plot faces toward the town's
    /// own bearing: not at all in a town that surveys no more than usual.
    pub fn alignment(&self) -> f64 {
        let beyond = (self.survey - 1.).max(0.);
        beyond / (1. + beyond)
    }
    /// How the town's plots stand beside an ordinary town's, across the front and back
    /// from it. Premises take their own size by this much more or less.
    pub fn plot_offer(&self) -> [f64; 2] {
        [
            self.plot_frontage / PLOT_FRONTAGE.default,
            self.plot_depth / PLOT_DEPTH.default,
        ]
    }
}

/// The rank a site held in `regard` has among a town's open sites, whose regards are
/// `sorted` from least to greatest: nothing for the least regarded, one for the most.
/// Sites held alike share the ranks between them by `chance`, so every rank is given out
/// as often as every other. A town with no open sites ranks by chance alone.
pub fn rank_among(sorted: &[f64], regard: f64, chance: f64) -> f64 {
    if sorted.is_empty() {
        return chance;
    }
    let below = sorted.partition_point(|other| *other < regard);
    let alike = sorted.partition_point(|other| *other <= regard) - below;
    (below as f64 + alike.max(1) as f64 * chance) / sorted.len().max(below + 1) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_orders_wealth_terms_shape_who_is_born_to_what() {
        let usual = Order::default();
        // The usual order leaves a household's means as they were before the terms came:
        // lot and standing over two and the patron's share, beside working income.
        let (draw, patronage, income) = (0.7, 1., 0.2);
        let before = (draw * 1.5 + income) / 2.5;
        assert!((usual.means(draw, patronage, income) - before).abs() < 1e-12);
        // An even order draws lots toward the middle; an unequal one gives most little.
        let even = Order {
            wealth_spread: 0.4,
            ..usual
        };
        let unequal = Order {
            wealth_spread: 4.,
            ..usual
        };
        assert!((even.lot(0.) - 0.3).abs() < 1e-12 && (even.lot(1.) - 0.7).abs() < 1e-12);
        assert!(unequal.lot(0.5) < 0.1 && unequal.lot(0.97) > 0.85);
        assert_eq!(usual.lot(0.37), 0.37);
        // Where birth counts for more, the same work lifts a poor household less.
        let born = Order {
            birthright: 3.,
            ..usual
        };
        assert!(born.means(0.1, 0., 0.5) < usual.means(0.1, 0., 0.5));
    }

    #[test]
    fn an_order_that_defers_to_standing_settles_a_share_of_households_by_it() {
        let usual = Order::default();
        // Where an order defers to standing, two households in three settle by it: they
        // take the rank their site holds, and the rest keep their own draw.
        let deferent = Order {
            deference: 3.,
            ..usual
        };
        assert!((deferent.settled_by_standing() - 2. / 3.).abs() < 1e-12);
        assert_eq!(deferent.settled_draw([0.2, 0.5], 0.9), 0.9);
        assert_eq!(deferent.settled_draw([0.2, 0.8], 0.9), 0.2);
        // An order that defers no more than usual settles nobody by standing.
        assert_eq!(usual.settled_by_standing(), 0.);
        assert_eq!(usual.settled_draw([0.2, 0.], 0.9), 0.2);
    }

    #[test]
    fn a_site_is_ranked_by_its_neighbours_means_however_many_they_are() {
        // Two streets whose neighbours have means of 0.6 and 0.2. With three neighbours or
        // thirty the summed means differ tenfold, and each street is still held as its
        // neighbours are.
        for neighbours in [3., 30.] {
            let street = |means: f64| crate::town::influence::Conditions {
                patronage: means * neighbours,
                neighbours,
                ..Default::default()
            };
            let (rich, poor) = (street(0.6).regard(), street(0.2).regard());
            assert!((rich - 0.6).abs() < 1e-12 && (poor - 0.2).abs() < 1e-12);
        }
        // A site with no neighbours is held only as its street's great houses make it.
        assert_eq!(crate::town::influence::Conditions::default().regard(), 0.);
        // Among four open sites, two of them held in no regard, the best held ranks in
        // the top quarter and the two unregarded share the lower half between them.
        let town = [0., 0., 0.2, 0.6];
        assert_eq!(rank_among(&town, 0.6, 0.5), 0.875);
        assert_eq!(rank_among(&town, 0., 0.5), 0.25);
        assert_eq!(rank_among(&town, 0., 0.999), 0.4995);
        // A site held above every open site ranks at the top, and a town with no open
        // sites ranks by chance.
        assert!(rank_among(&town, 2., 0.5) > 0.8 && rank_among(&town, 2., 0.5) <= 1.);
        assert_eq!(rank_among(&[], 0.6, 0.3), 0.3);
    }

    /// Two streets of one town fill a household at a time on the same lots, after the
    /// first street's first household is born great and the second's is not. Each street
    /// is held as the households on it are, with the dignity a great house lends the
    /// street it stands on, and its open sites are ranked among both streets'. Returns how
    /// many great houses stand on each.
    fn great_houses(order: &Order) -> [usize; 2] {
        let mut great = [0_usize; 2];
        // Each street's households: how many, and their means summed.
        let mut streets = [[0.; 2]; 2];
        for arrival in 0..40 {
            let held = |street: usize| {
                let [homes, means] = streets[street];
                let neighbours = if homes > 0. { means / homes } else { 0. };
                neighbours + if great[street] > 0 { 0.9 } else { 0. }
            };
            let regard = [held(0), held(1)];
            let mut open = regard;
            open.sort_by(f64::total_cmp);
            for street in 0..2 {
                let draw = |salt| crate::noise::hash_unit(salt, f64::from(arrival), 0.);
                let own = match (arrival, street) {
                    (0, 0) => 0.99,
                    (0, 1) => 0.3,
                    _ => draw(0x57a7),
                };
                let rank = rank_among(&open, regard[street], draw(0x1e55));
                let lot = if arrival == 0 {
                    own
                } else {
                    order.settled_draw([own, draw(0x0dd5)], rank)
                };
                let means = order.means(lot, streets[street][1], 0.25);
                streets[street][0] += 1.;
                streets[street][1] += means;
                great[street] += usize::from(means > 0.6);
            }
        }
        great
    }

    #[test]
    fn one_early_great_house_makes_a_great_street_where_standing_draws_standing() {
        let deferent = Order {
            deference: 3.,
            ..Order::default()
        };
        // The same households come to both streets after the first. The street whose
        // first was great draws the better born of them, and the other loses them.
        let [lucky, unlucky] = great_houses(&deferent);
        // A lead of one house grows to several, and to twice the other street's count.
        assert!(
            lucky >= 2 * unlucky && lucky >= unlucky + 3,
            "{lucky} against {unlucky}"
        );
        // Where standing counts for nothing the two streets differ by that one house.
        let deaf = Order {
            deference: 0.,
            ..Order::default()
        };
        let [first, second] = great_houses(&deaf);
        assert_eq!(first, second + 1);
    }

    /// Two streets each take one new workshop a round, of whichever of two trades finds
    /// it cheaper there; where neither is cheaper the streets take turns. Returns each
    /// street's share of the first trade.
    fn trades(order: &Order) -> [f64; 2] {
        // The first street starts with one smith, the second with one brewer.
        let mut streets = [[1., 0.], [0., 1.]];
        for round in 0..30 {
            for street in 0..2 {
                let in_town = [0, 1].map(|trade| streets[0][trade] + streets[1][trade]);
                let cost =
                    [0, 1].map(|trade| order.crowding(in_town[trade], streets[street][trade]));
                let cheaper = if cost[0] == cost[1] {
                    (round + street) % 2
                } else {
                    usize::from(cost[1] < cost[0])
                };
                streets[street][cheaper] += 1.;
            }
        }
        streets.map(|[first, second]| first / (first + second))
    }

    #[test]
    fn like_draws_like_until_each_street_has_a_trade_of_its_own() {
        let gathering = Order {
            clustering: 2.,
            satiety: 0.5,
            ..Order::default()
        };
        // One smith on one street and one brewer on the other end as a smiths' street
        // and a brewers' street.
        let [smiths_street, brewers_street] = trades(&gathering);
        assert!(
            smiths_street > 0.8 && brewers_street < 0.2,
            "{smiths_street} {brewers_street}"
        );
        // Where like does not draw like, each trade only deters itself and both streets
        // end with the same even mix.
        let scattering = Order {
            clustering: 0.,
            ..Order::default()
        };
        let [first, second] = trades(&scattering);
        assert!(
            (first - 0.5).abs() < 0.1 && (second - 0.5).abs() < 0.1,
            "{first} {second}"
        );
    }

    #[test]
    fn an_orders_trade_and_street_terms_change_nothing_at_one_and_with_no_clustering() {
        let plain = Order {
            character: 1.,
            clustering: 0.,
            ..Order::default()
        };
        // Busy frontage, a template's favour and the crowding of a trade read as before.
        assert_eq!(plain.trade_pull(5.), 1.);
        assert_eq!(plain.favour(2.5), 2.5);
        assert_eq!(plain.crowding(3., 7.), 4.);
        assert_eq!(plain.alignment(), 0.);
        // A market order pulls trade to busy frontage; a mingling one lets it spread.
        let market = Order {
            market: 2.,
            ..plain
        };
        let mingled = Order {
            market: 0.5,
            ..plain
        };
        assert!(market.trade_pull(3.) > 1. && mingled.trade_pull(3.) < 1.);
        assert_eq!(market.trade_pull(0.), 1.);
        // A town that shows its template strongly widens the gap between favours.
        let showing = Order {
            character: 2.,
            ..plain
        };
        assert!(showing.favour(3.) / showing.favour(1.5) > plain.favour(3.) / plain.favour(1.5));
        // A surveying town turns new frontage toward its own bearing, never wholly.
        let surveying = Order {
            survey: 3.,
            ..plain
        };
        assert!(surveying.alignment() > 0.5 && surveying.alignment() < 1.);
    }
}
