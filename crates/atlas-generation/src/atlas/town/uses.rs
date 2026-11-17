//! How many of each building a place needs and where the larger ones stand. The uses
//! themselves, their sizes and occupants are shared with the town tools (`atlas_map::town`).
use super::story::Size;
pub use atlas_map::town::{household, Trade, Use};

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
/// A building that needs a plot wider than a house's, and where it stands.
pub fn prefers(use_: Use) -> Option<Prefers> {
    Some(match use_ {
        Use::Temple | Use::Hall | Use::MarketHall | Use::Keep => Prefers::Centre,
        Use::Inn => Prefers::MainAt(0.3),
        Use::Smithy => Prefers::MainAt(0.75),
        Use::Barracks => Prefers::MainAt(0.5),
        Use::Tavern => Prefers::SideAt(0.5),
        Use::Mill | Use::Warehouse => Prefers::Water,
        Use::House | Use::Barn | Use::Workshop(_) => return None,
    })
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
        assert_eq!(prefers(Use::Inn), Some(Prefers::MainAt(0.3)));
        assert_eq!(prefers(Use::House), None);
    }
}
