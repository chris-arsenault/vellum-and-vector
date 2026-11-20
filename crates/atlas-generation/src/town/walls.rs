//! City walls on a city map. A wall is raised round the built land joined to the city's heart
//! at the time its builders raise it, courtyards and gardens within included. It runs along
//! the faces between enclosed and outside cells, is left out where water or steep ground
//! already defends, and opens a gate where a way crosses it. A city keeps every wall it
//! raises, so an outgrown wall stands inside the city and a citadel wall inside another.
//! Processes ask the enclosure question of any cell: how many walls enclose it.
use serde::{Deserialize, Serialize};

/// Built share at which land counts as the built city a wall is raised round.
pub const BUILT: f64 = 0.35;
/// Way share, on both sides of a face, at which a wall opens a gate there.
pub const GATE: f64 = 0.1;

/// One wall: the cells it encloses and the round it was raised in.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Wall {
    pub round: usize,
    /// Enclosed cells, ascending.
    pub inside: Vec<u32>,
}
impl Wall {
    pub fn encloses(&self, cell: usize) -> bool {
        self.inside.binary_search(&(cell as u32)).is_ok()
    }
}

/// How many of the walls enclose the cell: the enclosure question.
pub fn enclosure(walls: &[Wall], cell: usize) -> u32 {
    walls.iter().filter(|wall| wall.encloses(cell)).count() as u32
}

/// The cells a wall raised now would enclose: built land joined to `heart`, with every cell
/// it surrounds. A lattice cell missing a neighbour lies at the map's edge, outside.
pub fn enclosed(
    built: &[f64],
    open: &[bool],
    heart: usize,
    neighbours: impl Fn(usize) -> [Option<usize>; 3],
) -> Vec<bool> {
    let n = built.len();
    let mut city = vec![false; n];
    let mut stack = vec![heart];
    while let Some(cell) = stack.pop() {
        if city[cell] || !open[cell] || built[cell] < BUILT {
            continue;
        }
        city[cell] = true;
        stack.extend(neighbours(cell).into_iter().flatten());
    }
    // Everything the outside reaches without crossing the city stays outside.
    let mut outside = vec![false; n];
    stack.extend((0..n).filter(|&c| !city[c] && neighbours(c).iter().any(Option::is_none)));
    while let Some(cell) = stack.pop() {
        if outside[cell] || city[cell] {
            continue;
        }
        outside[cell] = true;
        stack.extend(neighbours(cell).into_iter().flatten());
    }
    outside.into_iter().map(|out| !out).collect()
}

/// A face between an enclosed cell and the outside: where a wall stands or a gate opens.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Face {
    pub inside: usize,
    pub outside: usize,
}

/// The faces a wall runs along and the faces where its gates open. Water and steep ground
/// defend a face themselves, so the wall leaves it out.
pub fn run(
    inside: &[bool],
    defended: &[bool],
    ways: &[f64],
    neighbours: impl Fn(usize) -> [Option<usize>; 3],
) -> (Vec<Face>, Vec<Face>) {
    let mut walls = Vec::new();
    let mut gates = Vec::new();
    for cell in (0..inside.len()).filter(|&c| inside[c]) {
        for next in neighbours(cell).into_iter().flatten() {
            if inside[next] || defended[next] {
                continue;
            }
            let face = Face {
                inside: cell,
                outside: next,
            };
            if ways[cell] >= GATE && ways[next] >= GATE {
                gates.push(face);
            } else {
                walls.push(face);
            }
        }
    }
    (walls, gates)
}

/// Share of the built land standing outside every wall; a city that has outgrown its walls
/// has reason to raise another.
pub fn outgrown(walls: &[Wall], built: &[f64]) -> f64 {
    let total: f64 = built.iter().filter(|&&b| b >= BUILT).sum();
    if total <= 0. {
        return 0.;
    }
    let outside: f64 = built
        .iter()
        .enumerate()
        .filter(|&(cell, &b)| b >= BUILT && enclosure(walls, cell) == 0)
        .map(|(_, b)| b)
        .sum();
    outside / total
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A square grid read as a lattice with up to three neighbours: left, right and one of
    /// up or down, alternating, so every cell is still reachable.
    fn grid(w: usize, h: usize) -> impl Fn(usize) -> [Option<usize>; 3] {
        move |cell| {
            let (x, y) = (cell % w, cell / w);
            let vertical = if (x + y) % 2 == 0 {
                (y + 1 < h).then(|| cell + w)
            } else {
                y.checked_sub(1).map(|y| y * w + x)
            };
            [
                x.checked_sub(1).map(|x| y * w + x),
                (x + 1 < w).then_some(cell + 1),
                vertical,
            ]
        }
    }

    const W: usize = 9;
    /// A square city built over five by five cells of a nine by nine map, with an unbuilt
    /// garden court at its middle and a way running east-west through its middle row.
    fn square_city() -> (Vec<bool>, Vec<f64>) {
        let mut built = vec![0.; W * W];
        for y in 2..7 {
            built[y * W + 2..y * W + 7].fill(1.);
        }
        built[4 * W + 4] = 0.;
        let inside = enclosed(&built, &[true; W * W], 3 * W + 3, grid(W, W));
        let mut ways = vec![0.; W * W];
        ways[4 * W..5 * W].fill(1.);
        (inside, ways)
    }

    #[test]
    fn a_wall_encloses_the_built_city_and_its_courtyards_and_opens_gates_on_its_ways() {
        let (inside, ways) = square_city();
        assert!(inside[4 * W + 4]);
        assert!(inside[2 * W + 2] && !inside[W + 1] && !inside[0]);
        let (walls, gates) = run(&inside, &[false; W * W], &ways, grid(W, W));
        assert!(!walls.is_empty());
        assert_eq!(gates.len(), 2);
        assert!(gates.iter().all(|g| g.inside / W == 4));
    }

    #[test]
    fn water_defends_its_side_so_the_wall_leaves_it_out() {
        let (inside, ways) = square_city();
        let (walls, _) = run(&inside, &[false; W * W], &ways, grid(W, W));
        let water: Vec<bool> = (0..W * W).map(|cell| cell % W == 1).collect();
        let (along_water, _) = run(&inside, &water, &ways, grid(W, W));
        assert!(along_water.iter().all(|f| f.outside % W != 1));
        assert!(along_water.len() < walls.len());
    }

    #[test]
    fn a_city_that_outgrows_its_wall_keeps_it_inside_and_counts_both() {
        let (w, h) = (11, 11);
        let mut built = vec![0.; w * h];
        for y in 4..7 {
            for x in 4..7 {
                built[y * w + x] = 1.;
            }
        }
        let open = vec![true; w * h];
        let first = enclosed(&built, &open, 5 * w + 5, grid(w, h));
        let old = Wall {
            round: 1,
            inside: (0..w * h).filter(|&c| first[c]).map(|c| c as u32).collect(),
        };
        assert_eq!(outgrown(std::slice::from_ref(&old), &built), 0.);
        for y in 2..9 {
            for x in 2..9 {
                built[y * w + x] = 1.;
            }
        }
        let share = outgrown(std::slice::from_ref(&old), &built);
        assert!(share > 0.5);
        let second = enclosed(&built, &open, 5 * w + 5, grid(w, h));
        let new = Wall {
            round: 2,
            inside: (0..w * h)
                .filter(|&c| second[c])
                .map(|c| c as u32)
                .collect(),
        };
        let walls = [old, new];
        assert_eq!(enclosure(&walls, 5 * w + 5), 2);
        assert_eq!(enclosure(&walls, 2 * w + 2), 1);
        assert_eq!(enclosure(&walls, 0), 0);
    }
}
