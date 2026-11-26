//! How catalogue places appear on a city map: the coarse map a city refinement makes, which
//! shows districts, main roads, walls, major works and prominent places but no ordinary
//! streets or houses. Each place says whether it shows there, what raises it at a hot spot,
//! its rough ground and symbol, and what it seeds when a district map is refined around it.
use super::catalogue::Kind;

/// What a city map reads at one hot spot of its refined social fields. Shares run from 0 to
/// 1 across the city; counts are whole.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CityReading {
    /// People on the ground, relative to the city's densest.
    pub density: f64,
    /// Share of the ground built on.
    pub built: f64,
    /// How long the ground has been built on, relative to the city's oldest.
    pub standing: f64,
    /// Means of the people living there, relative to the city's wealthiest.
    pub wealth: f64,
    /// Share of the people practising a craft.
    pub craft: f64,
    /// Share of the people who keep a common faith there.
    pub faith: f64,
    /// 0 at the city's heart, 1 at its edge.
    pub fringe: f64,
    /// Main ways meeting at the spot.
    pub ways: u32,
    /// The spot lies at usable shore.
    pub shore: bool,
    /// The city is a seat of power and the spot is where it sits.
    pub seat: bool,
    /// How many of the city's walls enclose the spot: the enclosure question.
    pub walls: u32,
    /// A way passes one of the city's walls at the spot.
    pub gate: bool,
}

/// A place standing out on the city map.
#[derive(Clone, Copy, Debug)]
pub struct CityAppearance {
    /// The city map's symbol for the place.
    pub symbol: &'static str,
    /// Rough ground at city scale, square metres, its grounds included.
    pub ground: f64,
    /// How strongly a hot spot's reading raises the place; zero leaves it unraised.
    pub raised_by: fn(&CityReading) -> f64,
    /// Uses the place seeds about itself when a district map is refined from the city map.
    pub seeds: &'static [Kind],
}

/// A catalogue place's large-scale appearance slot.
#[derive(Clone, Copy, Debug)]
pub enum CityMap {
    /// The place can stand out on a city map where a hot spot raises it.
    Shows(CityAppearance),
    /// The place stands only in the city map's built and density fields; the reason says why.
    Hidden(&'static str),
    /// Open work: the place's city appearance is not yet written.
    Unwritten,
}
impl CityMap {
    pub fn appearance(self) -> Option<CityAppearance> {
        match self {
            Self::Shows(appearance) => Some(appearance),
            Self::Hidden(_) | Self::Unwritten => None,
        }
    }
}

/// A reading that grows with each condition, so a place is raised most where all of its
/// conditions meet and not at all where one is wholly missing.
pub fn together(conditions: &[f64]) -> f64 {
    conditions.iter().map(|c| c.clamp(0., 1.)).product()
}

/// Ways meeting at a spot as a share, saturating at a crossing of four.
pub fn crossing(reading: &CityReading) -> f64 {
    (f64::from(reading.ways) / 4.).min(1.)
}

/// Hot spots: the cells where the city's social fields concentrate most, at least `spacing`
/// apart, most concentrated first.
pub fn hot_spots(score: &[f64], at: &[[f64; 2]], spacing: f64, count: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..score.len()).filter(|&c| score[c] > 0.).collect();
    order.sort_by(|&a, &b| score[b].total_cmp(&score[a]).then(a.cmp(&b)));
    let mut spots: Vec<usize> = Vec::new();
    for cell in order {
        if spots.len() >= count {
            break;
        }
        let [x, y] = at[cell];
        if spots
            .iter()
            .all(|&s| (at[s][0] - x).hypot(at[s][1] - y) >= spacing)
        {
            spots.push(cell);
        }
    }
    spots
}

/// A prominent place a hot-spot town built, at the city map cell it stands on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Placed {
    pub spot: usize,
    pub kind: Kind,
}

/// A place a hot-spot town built stands out on the city map where its catalogue slot shows it
/// and the spot's reading does not leave it unraised: none of its conditions wholly missing.
pub fn prominent(kind: Kind, reading: &CityReading) -> bool {
    use super::catalogue::PlaceRules;
    kind.definition()
        .city
        .appearance()
        .is_some_and(|appearance| (appearance.raised_by)(reading) > 0.)
}

/// Districts: each cell joins the seed it reaches most cheaply, where crossing water, a wall,
/// a main road or a change of character costs more than ordinary ground. Seeds are the city's
/// strongest hot spots, so districts gather round its centres and part along its barriers.
pub fn districts<N: IntoIterator<Item = Option<usize>>>(
    seeds: &[usize],
    n: usize,
    cost: impl Fn(usize, usize) -> f64,
    neighbours: impl Fn(usize) -> N,
) -> Vec<usize> {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;
    let mut label = vec![usize::MAX; n];
    let mut best = vec![f64::INFINITY; n];
    // hpc-exempt: a priority frontier over the lattice, popped in cost order.
    let mut frontier = BinaryHeap::new();
    for (i, &seed) in seeds.iter().enumerate() {
        best[seed] = 0.;
        label[seed] = i;
        frontier.push(Reverse((Ordered(0.), seed)));
    }
    while let Some(Reverse((Ordered(d), cell))) = frontier.pop() {
        if d > best[cell] {
            continue;
        }
        for next in neighbours(cell).into_iter().flatten() {
            // An infinite cost keeps ground out of every district.
            let through = d + cost(cell, next);
            if through.is_finite() && through < best[next] {
                best[next] = through;
                label[next] = label[cell];
                frontier.push(Reverse((Ordered(through), next)));
            }
        }
    }
    label
}
/// A cost ordered totally, for the district frontier.
#[derive(Clone, Copy, PartialEq)]
struct Ordered(f64);
impl Eq for Ordered {}
impl PartialOrd for Ordered {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Ordered {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&other.0)
    }
}

pub mod outline;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::town::catalogue::{works::WorkFamily, PlaceRules, PLACES};

    #[test]
    fn every_place_says_whether_and_how_it_appears_on_a_city_map() {
        for kind in PLACES {
            let definition = kind.definition();
            match definition.city {
                CityMap::Shows(appearance) => {
                    assert!(!appearance.symbol.is_empty(), "{}", definition.label);
                    // Rough ground is at least the place's own premises.
                    assert!(
                        appearance.ground >= definition.frontage.low * definition.depth.low,
                        "{}",
                        definition.label
                    );
                }
                CityMap::Hidden(reason) => assert!(!reason.is_empty(), "{}", definition.label),
                CityMap::Unwritten => panic!("{} has no city appearance", definition.label),
            }
        }
        for work in WorkFamily::ALL {
            let city = work.city();
            assert!(
                !city.symbol.is_empty() && city.ground > 0.,
                "{}",
                work.label()
            );
        }
    }

    #[test]
    fn city_resolution_follows_the_selected_area() {
        use crate::atlas::resolution::Quality;
        let reference = crate::scale::MapScale::REFERENCE_WIDTH
            * crate::scale::MapScale::REFERENCE_HEIGHT
            * 0.35;
        assert_eq!(Quality::level_for_extent(reference / 7.), 1);
        assert_eq!(Quality::level_for_extent(reference / 7f64.powi(5)), 5);
    }

    #[test]
    fn a_hot_spot_raises_the_places_its_reading_favours() {
        let raised = |reading: &CityReading| {
            let mut shown: Vec<_> = PLACES
                .into_iter()
                .filter_map(|kind| {
                    let appearance = kind.definition().city.appearance()?;
                    let strength = (appearance.raised_by)(reading);
                    (strength > 0.).then_some((strength, kind.definition().label))
                })
                .collect();
            shown.sort_by(|a, b| b.0.total_cmp(&a.0));
            shown
                .into_iter()
                .map(|(_, label)| label)
                .collect::<Vec<_>>()
        };
        // A dense old crossing of ways at the shore of a seat of power.
        let heart = CityReading {
            density: 1.,
            built: 1.,
            standing: 1.,
            wealth: 0.7,
            craft: 0.3,
            faith: 0.6,
            fringe: 0.,
            ways: 4,
            shore: true,
            seat: true,
            walls: 1,
            gate: false,
        };
        let shown = raised(&heart);
        for label in ["market", "landing", "court and confinement"] {
            assert!(shown.contains(&label), "{label} at the heart: {shown:?}");
        }
        // Open ground at the city's edge raises none of the heart's places.
        let edge = CityReading {
            fringe: 1.,
            ways: 1,
            ..CityReading::default()
        };
        let shown = raised(&edge);
        for label in ["market", "landing", "court and confinement", "manor"] {
            assert!(!shown.contains(&label), "{label} at the edge: {shown:?}");
        }
    }

    #[test]
    fn hot_spots_keep_apart_and_a_town_built_place_stands_out_where_its_conditions_meet() {
        let at: Vec<[f64; 2]> = (0..10).map(|i| [f64::from(i) * 100., 0.]).collect();
        let score = [0., 9., 8., 1., 0., 0., 5., 0., 0., 7.];
        // The two strongest cells are neighbours; only the first is kept.
        assert_eq!(hot_spots(&score, &at, 250., 3), vec![1, 9, 6]);
        let heart = CityReading {
            density: 1.,
            built: 1.,
            standing: 1.,
            wealth: 0.8,
            craft: 0.6,
            faith: 0.7,
            ways: 4,
            shore: true,
            seat: true,
            walls: 1,
            ..CityReading::default()
        };
        let edge = CityReading {
            fringe: 1.,
            ..CityReading::default()
        };
        let market = PLACES
            .into_iter()
            .find(|k| k.definition().label == "market")
            .unwrap();
        assert!(prominent(market, &heart));
        assert!(!prominent(market, &edge));
        // A place the city map hides never stands out, however its spot reads.
        let hidden = PLACES
            .into_iter()
            .find(|k| k.definition().city.appearance().is_none())
            .unwrap();
        assert!(!prominent(hidden, &heart));
    }

    #[test]
    fn districts_gather_round_their_seeds_and_part_along_barriers() {
        // A line of ten cells with a river between cells 4 and 5.
        let n = 10;
        let line = |cell: usize| {
            [
                cell.checked_sub(1),
                (cell + 1 < n).then_some(cell + 1),
                None,
            ]
        };
        let river = |a: usize, b: usize| {
            if a.min(b) == 4 && a.max(b) == 5 {
                20.
            } else {
                1.
            }
        };
        let label = districts(&[2, 8], n, river, line);
        assert_eq!(&label[..5], &[0; 5]);
        assert_eq!(&label[5..], &[1; 5]);
        // Without the river the parting falls halfway between the seeds.
        let even = districts(&[2, 8], n, |_, _| 1., line);
        assert_eq!(even[4], 0);
        assert_eq!(even[6], 1);
        // Ground outside the built city joins no district.
        let built = |_: usize, b: usize| if b >= 7 { f64::INFINITY } else { 1. };
        let city = districts(&[2, 5], n, built, line);
        assert!(city[7..].iter().all(|&l| l == usize::MAX));
        assert!(city[..7].iter().all(|&l| l != usize::MAX));
    }
}
