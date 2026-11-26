//! City household placement uses development edges, maintained ways and spreading
//! centres from the SLEUTH growth rules (Clarke, Hoppen and Gaydos 1997).
//! The shared gather process weighs these affinities alongside jobs, food and hazards.

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

/// A settlement template's city guidance for one growth pass.
pub struct Guidance {
    pub census: std::rc::Rc<Vec<crate::field::refinement::people::CensusCell>>,
    pub road_access: Vec<f64>,
    pub crossings: Vec<crate::links::Link>,
    /// The template's weight at each cell; zero reserves it.
    pub weight: Vec<f64>,
    /// Each cell's draw from the city's prominent places and works, 0 to 1.
    pub places: Vec<f64>,
}

/// Resolve the current city's development edges and streets for household placement.
pub fn affinities(field: &crate::field::Field, guidance: &Guidance) -> std::io::Result<Vec<f64>> {
    use crate::{
        field::shared::Scalar,
        human::{catalogue::LayerId, HumanField},
    };
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
    for (cell, way) in ways.iter_mut().enumerate() {
        // owner-direction(2026-11-25): household placement responds to the major roads laid in earlier city rounds.
        *way = access(
            *way / busiest,
            guidance.road_access.get(cell).copied().unwrap_or(0.),
        );
    }
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
    Ok(attraction(&cells, neighbours))
}

fn access(maintained: f64, city: f64) -> f64 {
    1. - (1. - maintained.clamp(0., 1.)) * (1. - city.clamp(0., 1.))
}

/// Travel benefits from roads most when both ends of the step are close to one.
pub(super) fn travel_friction(access: &[f64], a: usize, b: usize) -> f64 {
    1. - 0.5
        * access
            .get(a)
            .zip(access.get(b))
            .map_or(0., |(a, b)| a.min(*b))
            .powi(3)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_artery_supplies_access_without_first_becoming_a_regional_way() {
        assert!(access(0., 0.88) > access(0., 0.10));
        assert_eq!(access(1., 0.), 1.);
        assert_eq!(access(0., 0.), 0.);
        let street = [1., 1., 0.];
        assert!(super::travel_friction(&street, 0, 1) < super::travel_friction(&street, 1, 2));
        assert_eq!(super::travel_friction(&[], 0, 1), 1.);
    }

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
    fn built_edges_ways_and_places_draw_households_and_reservations_exclude_them() {
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
        // A charter reserving the way's cell turns that growth elsewhere.
        let mut reserved = guidance.clone();
        reserved[8] = 0.;
        let cells = Cells {
            guidance: &reserved,
            ..cells
        };
        let pull = attraction(&cells, line(n));
        assert_eq!(pull[8], 0.);
    }

    #[test]
    fn steep_ground_and_water_resist_growth() {
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
    }
}
