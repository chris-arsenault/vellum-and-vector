//! City growth on a city map, after the urban cellular-automaton growth rules of SLEUTH
//! (Clarke, Hoppen and Gaydos 1997): built land spreads from its edge, along its ways and from
//! spreading centres, and resists steep ground. Here the rules move people, not built land:
//! a share of each cell's people moves to the most attractive cell within reach, and the people
//! pass builds where people come to live. A settlement template's city guidance weighs every
//! cell, so a charter's rings or a ruling compound shape where the city grows.

/// Edge growth: ground beside built land draws the city outward.
const EDGE: f64 = 1.0;
/// Road-influenced growth: maintained ways carry the city along them.
const WAY: f64 = 0.8;
/// Spreading centres: crowded cells draw more people to themselves and their neighbours.
const CENTRE: f64 = 0.6;
/// A prominent place or major work draws people to the ground round it.
const PLACE: f64 = 0.6;
/// Slope at which ground resists building by half, in rise over run.
const SLOPE_RESISTANCE: f64 = 0.15;
/// The share of a cell's people that moves in a round toward a cell twice as attractive.
const MOVING: f64 = 0.2;
/// A target must be clearly more attractive than where people already live.
const MARGIN: f64 = 1.1;

/// Years of city life one growth pass stands for; its journeys wear the ways.
const GROWTH_YEARS: f64 = 10.;

/// A settlement template's city guidance for one growth pass.
pub struct Guidance {
    /// The template's weight at each cell; zero reserves it.
    pub weight: Vec<f64>,
    /// How many lattice steps people can move in one pass.
    pub reach: usize,
    /// Each cell's draw from the city's prominent places and works, 0 to 1.
    pub places: Vec<f64>,
}

/// Move a share of the city's people toward where it grows, through the people owner.
pub fn operation(
    owner: std::rc::Rc<crate::human::operations::Operations<crate::field::Field>>,
) -> crate::execution::Command<crate::field::Field, Guidance> {
    use crate::{
        field::shared::Scalar,
        human::{catalogue::LayerId, operations::Move, HumanField},
    };
    crate::execution::Command::with_inputs(
        "human.city.growth",
        crate::execution::CommandKind::Event,
        vec![],
        move |context, guidance: &Guidance| {
            let field = context.state();
            let mesh = &field.mesh;
            let n = mesh.len();
            let built = field.people.view(HumanField::Layer(LayerId::BuiltUp));
            let kept = field.people.view(HumanField::KeptLine);
            let slope_band = field.shared().scalar(Scalar::Slope);
            let mut people = Vec::with_capacity(n);
            let mut built_share = Vec::with_capacity(n);
            let mut ways = Vec::with_capacity(n);
            let mut slope = Vec::with_capacity(n);
            let mut open = Vec::with_capacity(n);
            for cell in 0..n {
                people.push(field.people.people(cell)?);
                built_share.push(built.get(cell)?.clamp(0., 1.));
                ways.push(kept.get(cell)?);
                slope.push(slope_band.get(cell)?);
                open.push(super::work::habitable(field, cell)?);
            }
            let busiest = ways.iter().copied().fold(0., f64::max).max(f64::EPSILON);
            ways.iter_mut().for_each(|w| *w /= busiest);
            let neighbours = |cell| [0, 1, 2].map(|edge| mesh.neighbor(cell, edge));
            let cells = Cells {
                people: &people,
                built: &built_share,
                ways: &ways,
                slope: &slope,
                open: &open,
                guidance: &guidance.weight,
                places: &guidance.places,
            };
            let pull = attraction(&cells, neighbours);
            let moved = moves(&pull, &people, guidance.reach, neighbours);
            let mut targets = field.coverage.borrow_mut().scratch(n, -1i32);
            let mut share = super::work::working(field);
            for (cell, (target, part)) in moved.into_iter().enumerate() {
                targets.set(cell, target)?;
                share.set(cell, part)?;
            }
            context.run(
                &owner.move_layer,
                &Move {
                    kind: LayerId::Population,
                    targets: targets.read_only(),
                    share: share.read_only(),
                    years: GROWTH_YEARS,
                },
            )
        },
    )
}

/// What city growth reads at each cell of the city map.
pub struct Cells<'a> {
    /// People per square kilometre.
    pub people: &'a [f64],
    /// Share of the cell built on, 0 to 1.
    pub built: &'a [f64],
    /// Maintained ways through the cell, 0 to 1.
    pub ways: &'a [f64],
    /// Ground slope, rise over run.
    pub slope: &'a [f64],
    /// People can live on the cell (dry ground).
    pub open: &'a [bool],
    /// The template's city guidance at the cell; zero reserves it.
    pub guidance: &'a [f64],
    /// The draw of the city's prominent places and works at the cell, 0 to 1.
    pub places: &'a [f64],
}

/// How strongly city growth draws people to each cell.
pub fn attraction(cells: &Cells<'_>, neighbours: impl Fn(usize) -> [Option<usize>; 3]) -> Vec<f64> {
    let densest = cells
        .people
        .iter()
        .copied()
        .fold(0., f64::max)
        .max(f64::EPSILON);
    (0..cells.people.len())
        .map(|cell| {
            if !cells.open[cell] {
                return 0.;
            }
            let around = neighbours(cell);
            let mean = |values: &[f64]| {
                let (sum, count) = around
                    .iter()
                    .flatten()
                    .fold((0., 0.), |(s, n), &c| (s + values[c], n + 1.));
                if count > 0. {
                    sum / count
                } else {
                    0.
                }
            };
            let edge = mean(cells.built).max(cells.built[cell]);
            let way = cells.ways[cell].clamp(0., 1.);
            let centre = (cells.people[cell] / densest).max(mean(cells.people) / densest);
            let place = cells.places.get(cell).copied().unwrap_or(0.).clamp(0., 1.);
            let pull = EDGE * edge + WAY * way + CENTRE * centre + PLACE * place;
            let resistance = 1. / (1. + cells.slope[cell].max(0.) / SLOPE_RESISTANCE);
            pull * resistance * cells.guidance[cell].max(0.)
        })
        .collect()
}

/// Where each cell's people move this round, and what share of them: to the most attractive
/// cell within `reach` steps, when it is clearly more attractive than their own.
pub fn moves(
    attraction: &[f64],
    people: &[f64],
    reach: usize,
    neighbours: impl Fn(usize) -> [Option<usize>; 3],
) -> Vec<(i32, f64)> {
    let mut seen = vec![usize::MAX; attraction.len()];
    let mut frontier = Vec::new();
    let mut next = Vec::new();
    (0..attraction.len())
        .map(|cell| {
            if people[cell] <= 0. {
                return (-1, 0.);
            }
            // A breadth-first walk over the lattice to `reach` steps; marks reuse `seen`.
            frontier.clear();
            frontier.push(cell);
            seen[cell] = cell;
            let mut best = (cell, attraction[cell] * MARGIN);
            for _ in 0..reach {
                next.clear();
                for &at in &frontier {
                    for to in neighbours(at).into_iter().flatten() {
                        if seen[to] == cell {
                            continue;
                        }
                        seen[to] = cell;
                        next.push(to);
                        if attraction[to] > best.1 {
                            best = (to, attraction[to]);
                        }
                    }
                }
                std::mem::swap(&mut frontier, &mut next);
            }
            if best.0 == cell {
                return (-1, 0.);
            }
            let gain = 1. - attraction[cell] / best.1;
            (best.0 as i32, (MOVING * 2. * gain).min(MOVING))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A line of cells, each with the cells beside it.
    fn line(n: usize) -> impl Fn(usize) -> [Option<usize>; 3] {
        move |cell| {
            [
                cell.checked_sub(1),
                (cell + 1 < n).then_some(cell + 1),
                None,
            ]
        }
    }

    #[test]
    fn people_move_toward_the_built_edge_and_its_ways_and_never_onto_reserved_ground() {
        let n = 12;
        let mut built = vec![0.; n];
        built[..4].fill(1.);
        let mut ways = vec![0.; n];
        ways[8] = 1.;
        let people = {
            let mut p = vec![0.; n];
            p[..4].fill(800.);
            p[10] = 50.;
            p
        };
        let open = vec![true; n];
        let slope = vec![0.; n];
        let guidance = vec![1.; n];
        let none = vec![0.; n];
        let cells = Cells {
            people: &people,
            built: &built,
            ways: &ways,
            slope: &slope,
            open: &open,
            guidance: &guidance,
            places: &none,
        };
        let pull = attraction(&cells, line(n));
        // The ground just beyond the built edge draws more than open ground far from it.
        assert!(pull[4] > pull[6]);
        // A way draws growth along it.
        assert!(pull[8] > pull[7]);
        // A prominent place draws people to the ground round it.
        let mut market = none.clone();
        market[6] = 1.;
        let drawn = attraction(
            &Cells {
                places: &market,
                ..cells
            },
            line(n),
        );
        assert!(drawn[6] > pull[6] && drawn[5] == pull[5]);
        let moved = moves(&pull, &people, 3, line(n));
        // The outlying family moves toward the way, not further out.
        assert_eq!(moved[10].0, 8);
        // A charter reserving the way's cell turns that growth elsewhere.
        let mut reserved = guidance.clone();
        reserved[8] = 0.;
        let cells = Cells {
            guidance: &reserved,
            ..cells
        };
        let pull = attraction(&cells, line(n));
        assert_eq!(pull[8], 0.);
        assert!(moves(&pull, &people, 3, line(n))
            .iter()
            .all(|&(target, _)| target != 8));
    }

    #[test]
    fn steep_ground_and_water_resist_growth_and_shares_stay_partial() {
        let n = 6;
        let built = vec![1., 1., 0., 0., 0., 0.];
        let people = vec![900., 900., 0., 0., 0., 0.];
        let ways = vec![0.; n];
        let guidance = vec![1.; n];
        let mut slope = vec![0.; n];
        slope[2] = 0.6;
        let mut open = vec![true; n];
        open[3] = false;
        let none = vec![0.; n];
        let cells = Cells {
            people: &people,
            built: &built,
            ways: &ways,
            slope: &slope,
            open: &open,
            guidance: &guidance,
            places: &none,
        };
        let pull = attraction(&cells, line(n));
        assert!(pull[2] < 0.5 * pull[1]);
        assert_eq!(pull[3], 0.);
        for (target, share) in moves(&pull, &people, 4, line(n)) {
            assert!((0. ..=MOVING).contains(&share));
            assert_ne!(target, 3);
        }
    }
}
