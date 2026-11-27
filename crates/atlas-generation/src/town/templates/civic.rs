//! The civic order: who holds a settlement and how its wealth and its decisions are
//! spread. It is one of the independent choices a settlement's policy is drawn on, beside
//! its founding template, and it speaks only through the town's order: the terms the
//! rules that build a town read. It adds nothing to the amounts a district's economy and
//! residents ask for.
use super::SiteEvidence;
use crate::town::order::Order;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Civic {
    /// A ruling house holds a fortified seat; the town stands outside it.
    PrincelySeat,
    /// One authority assigns ground and lays the streets ahead of building.
    Autocracy,
    /// Owners hold walled compounds; the people they hold are packed close with few ways out.
    SlaveHolding,
    /// Kin groups each keep their own court; elders settle what lies between.
    CouncilOfElders,
    /// Every household holds its own plot and answers to none.
    Freehold,
    /// Households agree a common standard and keep ways open to all.
    Democracy,
    /// Traders govern; ground is worth what its frontage sells.
    MerchantCouncil,
}

/// How a civic order changes each term of a town's order, as a multiple of what the map
/// gave it: street spacing, back lane, crossing spacing, shortcut saving, street work,
/// plot frontage and plot depth.
struct Hand {
    street_spacing: f64,
    back_lane: f64,
    crossing_spacing: f64,
    shortcut_saving: f64,
    street_work: f64,
    plot_frontage: f64,
    plot_depth: f64,
}
const fn hand(streets: [f64; 4], street_work: f64, plot: [f64; 2]) -> Hand {
    Hand {
        street_spacing: streets[0],
        back_lane: streets[1],
        crossing_spacing: streets[2],
        shortcut_saving: streets[3],
        street_work,
        plot_frontage: plot[0],
        plot_depth: plot[1],
    }
}

impl Civic {
    pub const ALL: [Self; 7] = [
        Self::PrincelySeat,
        Self::Autocracy,
        Self::SlaveHolding,
        Self::CouncilOfElders,
        Self::Freehold,
        Self::Democracy,
        Self::MerchantCouncil,
    ];
    pub fn name(self) -> &'static str {
        match self {
            Self::PrincelySeat => "princely-seat",
            Self::Autocracy => "autocracy",
            Self::SlaveHolding => "slave-holding",
            Self::CouncilOfElders => "council-of-elders",
            Self::Freehold => "freehold",
            Self::Democracy => "democracy",
            Self::MerchantCouncil => "merchant-council",
        }
    }
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|civic| civic.name() == name)
    }
    /// The order's tickets in a site's draw: one for being possible, more for each thing
    /// the site's record says in its favour, none where the record rules it out.
    pub fn tickets(self, site: &SiteEvidence) -> u32 {
        let has = |fact: bool, tickets: u32| if fact { tickets } else { 0 };
        let ways = site.approaches.len();
        1 + match self {
            Self::PrincelySeat => has(site.seat, 2) + has(site.guarded, 1) + has(site.old, 1),
            Self::Autocracy => has(site.planned, 2) + has(site.seat, 1) + has(site.guarded, 1),
            // Households the record calls free are not held.
            Self::SlaveHolding if site.free_tenure => return 0,
            Self::SlaveHolding => has(site.guarded, 1) + has(site.cultivated, 1),
            Self::CouncilOfElders => has(site.old, 2) + has(!site.seat, 1) + has(ways <= 2, 1),
            Self::Freehold => {
                has(site.free_tenure, 2) + has(site.cultivated, 1) + has(!site.guarded, 1)
            }
            Self::Democracy => has(site.free_tenure, 1) + has(!site.seat, 1) + has(ways >= 3, 1),
            Self::MerchantCouncil => {
                has(ways >= 3, 2) + has(site.shore.is_some(), 1) + has(site.industry.is_some(), 1)
            }
        }
    }
    /// Draws an order for the site in proportion to the tickets each holds.
    pub fn draw(site: &SiteEvidence, draw: f64) -> Self {
        let tickets = Self::ALL.map(|civic| civic.tickets(site));
        let total: u32 = tickets.iter().sum();
        let mut ticket = ((draw.clamp(0., 1.) * f64::from(total)) as u32).min(total - 1);
        for (civic, held) in Self::ALL.into_iter().zip(tickets) {
            if ticket < held {
                return civic;
            }
            ticket -= held;
        }
        Self::Freehold
    }
    fn hand(self) -> Hand {
        match self {
            // A few broad ways to the seat; the town grows as it will.
            Self::PrincelySeat => hand([1.2, 1., 1., 1.2], 1.2, [1.1, 1.1]),
            // Broad, widely spaced streets and large regular plots, laid by decree.
            Self::Autocracy => hand([2., 1., 1.5, 1.6], 2., [1.3, 1.3]),
            // Few ways through, little street work, small plots for the held.
            Self::SlaveHolding => hand([1.5, 0.5, 1.5, 2.], 0.8, [0.7, 0.7]),
            // Close lanes that end inside each kin's ground, few ways through.
            Self::CouncilOfElders => hand([0.5, 1.5, 0.7, 1.8], 0.7, [0.8, 0.8]),
            // Wide plots, and streets only where households wear them.
            Self::Freehold => hand([1., 1., 1., 1.], 0.8, [1.6, 1.5]),
            // An even standard and many ways through.
            Self::Democracy => hand([1.2, 1., 1., 0.5], 1.3, [1., 1.]),
            // Narrow deep plots on busy frontage, with lanes behind.
            Self::MerchantCouncil => hand([0.8, 1.2, 0.8, 0.7], 1.5, [0.8, 1.2]),
        }
    }
    /// Writes the order's hand onto a town's order.
    pub fn write(self, order: &mut Order) {
        let hand = self.hand();
        order.street_spacing *= hand.street_spacing;
        order.back_lane *= hand.back_lane;
        order.crossing_spacing *= hand.crossing_spacing;
        order.shortcut_saving = (order.shortcut_saving * hand.shortcut_saving).min(1.);
        order.street_work *= hand.street_work;
        order.plot_frontage *= hand.plot_frontage;
        order.plot_depth *= hand.plot_depth;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sites_record_weights_the_draw_and_chance_still_chooses() {
        let plain = SiteEvidence::default();
        // On a site that says nothing every order can be drawn.
        let drawn: Vec<_> = (0..70)
            .map(|step| Civic::draw(&plain, f64::from(step) / 70.))
            .collect();
        assert!(Civic::ALL.iter().all(|civic| drawn.contains(civic)));
        // A realm's old guarded seat favours a ruling house, and may still be otherwise.
        let seat = SiteEvidence {
            seat: true,
            guarded: true,
            old: true,
            ..Default::default()
        };
        assert_eq!(Civic::PrincelySeat.tickets(&seat), 5);
        assert!(Civic::PrincelySeat.tickets(&seat) > Civic::Democracy.tickets(&seat));
        assert!(Civic::Democracy.tickets(&seat) > 0);
        // Households the record calls free are never held.
        let free = SiteEvidence {
            free_tenure: true,
            ..Default::default()
        };
        assert_eq!(Civic::SlaveHolding.tickets(&free), 0);
        assert!((0..100)
            .all(|step| { Civic::draw(&free, f64::from(step) / 100.) != Civic::SlaveHolding }));
        assert_eq!(Civic::draw(&plain, 1.), Civic::MerchantCouncil);
    }

    #[test]
    fn each_order_writes_its_own_hand_on_a_towns_order() {
        let usual = Order::default();
        let written = |civic: Civic| {
            let mut order = usual;
            civic.write(&mut order);
            order
        };
        // Decree spaces streets widely; kin courts keep them close.
        assert!(written(Civic::Autocracy).street_spacing > usual.street_spacing);
        assert!(written(Civic::CouncilOfElders).street_spacing < usual.street_spacing);
        // A freeholder's plot is wider than a held household's.
        assert!(
            written(Civic::Freehold).plot_frontage > written(Civic::SlaveHolding).plot_frontage
        );
        // A shortcut can never need to save more than the whole walk.
        assert!(Civic::ALL
            .iter()
            .all(|civic| written(*civic).shortcut_saving <= 1.));
        // No two orders write the same hand.
        for (i, a) in Civic::ALL.iter().enumerate() {
            for b in &Civic::ALL[i + 1..] {
                assert_ne!(written(*a), written(*b), "{a:?} and {b:?}");
            }
        }
        assert_eq!(
            Civic::from_name("merchant-council"),
            Some(Civic::MerchantCouncil)
        );
    }
}
