//! What each building is for, how many of each a place needs, and who lives in it.
use super::story::Size;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trade {
    Baker,
    Weaver,
    Cooper,
    Tanner,
    Potter,
    Carpenter,
    Butcher,
    Chandler,
    Mason,
    Brewer,
}
const TRADES: [Trade; 10] = [
    Trade::Baker,
    Trade::Weaver,
    Trade::Cooper,
    Trade::Carpenter,
    Trade::Butcher,
    Trade::Potter,
    Trade::Chandler,
    Trade::Brewer,
    Trade::Mason,
    Trade::Tanner,
];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Use {
    House,
    Barn,
    Workshop(Trade),
    Inn,
    Tavern,
    Smithy,
    Temple,
    Hall,
    MarketHall,
    Mill,
    Warehouse,
    Keep,
    Barracks,
}
/// Where a building with a wide plot of its own prefers to stand.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Prefers {
    /// On a main street, as near the centre as it can.
    Centre,
    /// On a main street, about this share of the place's reach from the centre.
    MainAt(f64),
    /// On a side street about this share of the reach from the centre.
    SideAt(f64),
    /// Backing onto water.
    Water,
}
impl Use {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::House => "house",
            Self::Barn => "barn",
            Self::Workshop(trade) => trade.as_str(),
            Self::Inn => "inn",
            Self::Tavern => "tavern",
            Self::Smithy => "smithy",
            Self::Temple => "temple",
            Self::Hall => "hall",
            Self::MarketHall => "marketHall",
            Self::Mill => "mill",
            Self::Warehouse => "warehouse",
            Self::Keep => "keep",
            Self::Barracks => "barracks",
        }
    }
    /// The naming work term that names its household or business.
    pub fn work(self) -> &'static str {
        match self {
            Self::House | Self::Barn => "household",
            Self::Workshop(_) => "workshop",
            other => other.as_str(),
        }
    }
    /// Frontage and depth of the building in metres, before it is fitted to its plot.
    pub fn footprint(self, size: Size) -> (f64, f64) {
        let house = if size >= Size::Town { 9.0 } else { 7.0 };
        match self {
            Self::House | Self::Workshop(_) => (f64::INFINITY, house),
            Self::Barn => (10.0, 14.0),
            Self::Inn => (14.0, 12.0),
            Self::Tavern | Self::Smithy => (10.0, 9.0),
            Self::Temple => (12.0, 24.0),
            Self::Hall => (16.0, 12.0),
            Self::MarketHall => (20.0, 10.0),
            Self::Mill => (10.0, 10.0),
            Self::Warehouse => (16.0, 14.0),
            Self::Keep => (22.0, 22.0),
            Self::Barracks => (30.0, 12.0),
        }
    }
    /// A building that needs a plot wider than a house's, and where it stands.
    pub fn prefers(self) -> Option<Prefers> {
        Some(match self {
            Self::Temple | Self::Hall | Self::MarketHall | Self::Keep => Prefers::Centre,
            Self::Inn => Prefers::MainAt(0.3),
            Self::Smithy => Prefers::MainAt(0.75),
            Self::Barracks => Prefers::MainAt(0.5),
            Self::Tavern => Prefers::SideAt(0.5),
            Self::Mill | Self::Warehouse => Prefers::Water,
            Self::House | Self::Barn | Self::Workshop(_) => return None,
        })
    }
    /// How many people live in it on average, and whether a household keeps it.
    pub fn occupants(self, size: Size) -> f64 {
        match self {
            Self::House | Self::Workshop(_) => household(size),
            Self::Inn | Self::Tavern | Self::Smithy | Self::Mill => 5.0,
            Self::Temple | Self::Hall => 2.0,
            Self::Keep => 20.0,
            Self::Barracks => 40.0,
            Self::Barn | Self::MarketHall | Self::Warehouse => 0.0,
        }
    }
    pub fn storeys(self, size: Size) -> u32 {
        match (self, size) {
            (Self::Keep, _) => 3,
            (Self::Barn | Self::Temple | Self::MarketHall | Self::Mill, _) => 1,
            (_, Size::City) => 3,
            (_, Size::Town) => 2,
            _ => 1,
        }
    }
}
impl Trade {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Baker => "bakery",
            Self::Weaver => "weaver",
            Self::Cooper => "cooper",
            Self::Tanner => "tannery",
            Self::Potter => "pottery",
            Self::Carpenter => "carpenter",
            Self::Butcher => "butcher",
            Self::Chandler => "chandler",
            Self::Mason => "mason",
            Self::Brewer => "brewery",
        }
    }
}
/// People to a household; city households crowd more into each house.
pub fn household(size: Size) -> f64 {
    if size == Size::City {
        6.0
    } else {
        5.0
    }
}
/// What a settlement's story asks of its ground.
pub struct Needs {
    pub people: f64,
    pub size: Size,
    pub ways: usize,
    pub waterside: bool,
    pub walled: bool,
    pub seat: bool,
}
fn count(base: usize, people: f64, per: f64) -> usize {
    base + (people / per).floor() as usize
}
/// The buildings with plots of their own a place needs, most important first.
pub fn special(needs: &Needs) -> Vec<Use> {
    let (people, size) = (needs.people, needs.size);
    let village = size >= Size::Village;
    let town = size >= Size::Town;
    let rows: [(Use, bool, usize); 10] = [
        (Use::Temple, village, count(1, people, 4_000.0)),
        (Use::Hall, town, 1),
        (Use::MarketHall, town, count(1, people, 20_000.0)),
        (Use::Keep, town && (needs.walled || needs.seat), 1),
        (
            Use::Inn,
            size >= Size::Hamlet && needs.ways > 0,
            count(1, people, 1_500.0),
        ),
        (Use::Smithy, size >= Size::Hamlet, count(1, people, 2_000.0)),
        (
            Use::Mill,
            village && needs.waterside,
            count(1, people, 5_000.0),
        ),
        (Use::Tavern, village, count(0, people, 600.0)),
        (
            Use::Warehouse,
            town && needs.waterside,
            count(0, people, 3_000.0),
        ),
        (Use::Barracks, size == Size::City && needs.walled, 1),
    ];
    rows.into_iter()
        .filter(|(_, wanted, _)| *wanted)
        .flat_map(|(kind, _, n)| std::iter::repeat_n(kind, n))
        .collect()
}
/// The uses of the place's ordinary plots: houses, with a trade in every so many.
pub fn ordinary(needs: &Needs, housed_elsewhere: f64) -> Vec<Use> {
    let homes = ((needs.people - housed_elsewhere).max(0.0) / household(needs.size))
        .ceil()
        .max(1.0) as usize;
    let trades = if needs.size >= Size::Village {
        (needs.people / 120.0).floor() as usize
    } else {
        0
    };
    let every = homes.checked_div(trades).map_or(usize::MAX, |n| n.max(1));
    (0..homes.max(trades))
        .map(|i| {
            if trades > 0 && i % every == every / 2 && i / every < trades {
                Use::Workshop(TRADES[(i / every) % TRADES.len()])
            } else {
                Use::House
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn needs(people: f64) -> Needs {
        Needs {
            people,
            size: Size::of(people),
            ways: 2,
            waterside: true,
            walled: false,
            seat: false,
        }
    }
    #[test]
    fn a_town_needs_more_kinds_of_building_than_a_village() {
        let village = special(&needs(400.0));
        assert!(village.contains(&Use::Temple) && village.contains(&Use::Inn));
        assert!(village.contains(&Use::Mill));
        assert!(!village.contains(&Use::Hall));
        let town = special(&needs(5_000.0));
        for wanted in [Use::Hall, Use::MarketHall, Use::Warehouse] {
            assert!(town.contains(&wanted), "{wanted:?}");
        }
        assert_eq!(town.iter().filter(|u| **u == Use::Tavern).count(), 8);
        assert!(!town.contains(&Use::Keep));
        let hamlet = special(&Needs {
            ways: 0,
            ..needs(60.0)
        });
        assert_eq!(hamlet, vec![Use::Smithy]);
    }
    #[test]
    fn ordinary_plots_house_the_rest_with_trades_among_them() {
        let plots = ordinary(&needs(1_200.0), 100.0);
        assert_eq!(plots.len(), 220);
        let trades = plots
            .iter()
            .filter(|u| matches!(u, Use::Workshop(_)))
            .count();
        assert_eq!(trades, 10);
        assert_eq!(ordinary(&needs(3.0), 0.0), vec![Use::House]);
        assert_eq!(Use::Inn.prefers(), Some(Prefers::MainAt(0.3)));
        assert_eq!(Use::House.prefers(), None);
    }
}
