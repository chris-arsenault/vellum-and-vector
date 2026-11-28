//! Things that spread over the lattice a cell at a time.
use super::Chance;
use crate::{
    hpc::{Direction, MultiKeyHeap},
    lattice::TriangularLattice,
};

/// A front that sets out from some cells and spreads to their neighbours. Crossing into
/// a cell takes the time its distance and the front's pace there call for, stretched or
/// shortened by a wait drawn for that cell. At `roughness` nought the front keeps an
/// even edge; toward one it runs ahead where its waits are short and hangs back where
/// they are long, leaving tongues, bays and islands it fills in later.
///
/// A rule spreads something by asking when the front arrives everywhere, once, and
/// taking each round the cells it has reached by then: settlement over farmland, forest
/// over a burn, a quarter over open ground. The arrivals do not depend on the order
/// cells are visited in, and a later round's front contains an earlier one's.
#[derive(Clone, Copy, Debug)]
pub struct Front {
    pub chance: Chance,
    pub roughness: f64,
}
impl Front {
    /// When the front reaches each cell of `mesh`, starting at nought on `sources`.
    /// `pace` is how fast it crosses from one cell into a neighbour, in distance a unit
    /// of time, or nothing where it cannot enter. Cells it has not reached by `until`
    /// are left at infinity.
    pub fn arrivals(
        &self,
        mesh: &TriangularLattice,
        sources: &[usize],
        until: f64,
        pace: impl Fn(usize, usize) -> Option<f64>,
    ) -> Vec<f64> {
        let mut arrival = vec![f64::INFINITY; mesh.len()];
        let mut reached = MultiKeyHeap::new([Direction::Ascending], Direction::Ascending);
        for &source in sources {
            arrival[source] = 0.0;
            reached.push(source as u32, [0.0]);
        }
        while let Some((cell, [at])) = reached.pop() {
            let cell = cell as usize;
            if at > arrival[cell] || at > until {
                continue;
            }
            for next in (0..3).filter_map(|edge| mesh.neighbor(cell, edge)) {
                let Some(pace) = pace(cell, next).filter(|pace| *pace > 0.0) else {
                    continue;
                };
                let then = at + mesh.physical_distance(cell, next) / pace * self.stretch(next);
                if then < arrival[next] && then <= until {
                    arrival[next] = then;
                    reached.push(next as u32, [then]);
                }
            }
        }
        arrival
    }
    /// How much longer or shorter than its distance calls for the front takes to enter
    /// a cell: one on average.
    fn stretch(&self, cell: usize) -> f64 {
        let wait = self.chance.wait([cell as f64, 0.0], 1.0);
        (1.0 - self.roughness) + self.roughness * wait
    }
}

/// One round of a quantity seeping between neighbouring cells. Each pair of neighbours
/// evens out by the part `share` of their difference, as far as the less open of the two
/// lets it; `open` is how freely a cell lets the quantity through, from nought to one.
/// Where openness is patchy the quantity soaks along the open ground and pools behind
/// the closed, so repeated rounds leave tongues and pockets where an even blur would
/// leave a smooth mound. What leaves one cell enters another; nothing is made or lost.
pub fn seep(mesh: &TriangularLattice, values: &mut [f64], share: f64, open: impl Fn(usize) -> f64) {
    let mut change = vec![0.0; values.len()];
    for cell in 0..mesh.len() {
        for next in (0..3).filter_map(|edge| mesh.neighbor(cell, edge)) {
            // Each pair is settled once, from its lower-numbered cell.
            if next <= cell {
                continue;
            }
            let lets = open(cell).min(open(next)).clamp(0.0, 1.0);
            let flow = share / 3.0 * lets * (values[cell] - values[next]);
            change[cell] -= flow;
            change[next] += flow;
        }
    }
    for (value, change) in values.iter_mut().zip(change) {
        *value += change;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{chance::Patches, lattice::WorldLatticeOptions};
    use atlas_map::Bounds;

    fn plain() -> TriangularLattice {
        WorldLatticeOptions::default()
            .build(Bounds(0., 0., 2_000., 2_000.), 2_500., 0., |_, _| true)
            .unwrap()
    }
    /// The lattice's middle, in its own positions.
    fn centre(mesh: &TriangularLattice) -> [f64; 2] {
        let Bounds(west, south, east, north) = mesh.bounds();
        [(west + east) / 2., (south + north) / 2.]
    }
    /// The cell `east` and `north` of the middle.
    fn off(mesh: &TriangularLattice, east: f64, north: f64) -> usize {
        let [x, y] = centre(mesh);
        mesh.cell_at(x + east, y + north).unwrap()
    }
    fn middle(mesh: &TriangularLattice) -> usize {
        off(mesh, 0., 0.)
    }
    /// How far east of the middle a cell lies.
    fn east(mesh: &TriangularLattice, cell: usize) -> f64 {
        mesh.position(cell)[0] - centre(mesh)[0]
    }
    fn from_middle(mesh: &TriangularLattice, cell: usize) -> f64 {
        let ([x, y], [cx, cy]) = (mesh.position(cell), centre(mesh));
        (x - cx).hypot(y - cy)
    }
    /// How far from round the ground a front has reached by `time` is: the spread of its
    /// edge cells' distances from the source, beside their mean.
    fn raggedness(mesh: &TriangularLattice, arrival: &[f64], time: f64) -> f64 {
        let edge: Vec<f64> = (0..mesh.len())
            .filter(|&cell| {
                arrival[cell] <= time
                    && (0..3)
                        .filter_map(|e| mesh.neighbor(cell, e))
                        .any(|next| arrival[next] > time)
            })
            .map(|cell| from_middle(mesh, cell))
            .collect();
        let mean = edge.iter().sum::<f64>() / edge.len() as f64;
        let spread = edge.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / edge.len() as f64;
        spread.sqrt() / mean
    }

    #[test]
    fn a_smooth_front_keeps_an_even_edge_and_a_rough_one_runs_ahead_and_hangs_back() {
        let mesh = plain();
        let front = |roughness| Front {
            chance: Chance::named(3, "test.front"),
            roughness,
        };
        let spread = |roughness| {
            front(roughness).arrivals(&mesh, &[middle(&mesh)], f64::INFINITY, |_, _| Some(1.))
        };
        let (smooth, rough) = (spread(0.), spread(1.));
        // Every cell is reached, later the further it lies.
        assert!(smooth.iter().all(|at| at.is_finite()));
        let (near, far) = (off(&mesh, 100., 0.), off(&mesh, 800., 0.));
        assert!(smooth[near] < smooth[far] && rough[near] < rough[far]);
        // Half way out, the rough front's edge is about twice as ragged: waits drawn cell
        // by cell fray an edge without reshaping it.
        let (even, ragged) = (
            raggedness(&mesh, &smooth, 500.),
            raggedness(&mesh, &rough, 500.),
        );
        assert!(ragged > 1.8 * even, "{even} {ragged}");
        // Tongues and bays come from ground the front crosses at different paces: here
        // quick over patches that cover half the ground and slow between them.
        let patches = Patches::of(Chance::named(3, "test.front.ground").noise(350., 2));
        let patchy = Front {
            chance: Chance::named(3, "test.front"),
            roughness: 1.,
        }
        .arrivals(&mesh, &[middle(&mesh)], f64::INFINITY, |_, to| {
            Some(if patches.covers(mesh.position(to), 0.5) {
                1.
            } else {
                0.15
            })
        });
        let reach = |arrival: &[f64], time: f64| arrival.iter().filter(|at| **at <= time).count();
        // Compared when each has covered about as much ground.
        let time = (500..6_000)
            .map(f64::from)
            .find(|time| reach(&patchy, *time) >= reach(&rough, 500.))
            .unwrap();
        let tongued = raggedness(&mesh, &patchy, time);
        assert!(tongued > 1.5 * ragged, "{ragged} {tongued}");
    }

    #[test]
    fn a_front_grows_without_ever_giving_ground_and_stops_at_what_it_cannot_enter() {
        let mesh = plain();
        let front = Front {
            chance: Chance::named(3, "test.front"),
            roughness: 0.8,
        };
        // Nothing more than 400 east of the middle can be entered.
        let open = |_, to: usize| (east(&mesh, to) < 400.).then_some(1.);
        let whole = front.arrivals(&mesh, &[middle(&mesh)], f64::INFINITY, open);
        let early = front.arrivals(&mesh, &[middle(&mesh)], 300., open);
        for cell in 0..mesh.len() {
            if east(&mesh, cell) >= 400. {
                assert!(whole[cell].is_infinite());
            }
            // What had arrived by 300 arrived at the same moment in the longer run.
            if early[cell].is_finite() {
                assert!(early[cell] <= 300. && early[cell] == whole[cell]);
            } else {
                assert!(whole[cell] > 300.);
            }
        }
        assert!(early.iter().filter(|at| at.is_finite()).count() > 50);
        // Faster ground is reached sooner.
        let quick = front.arrivals(&mesh, &[middle(&mesh)], f64::INFINITY, |_, _| Some(4.));
        let slow = front.arrivals(&mesh, &[middle(&mesh)], f64::INFINITY, |_, _| Some(1.));
        let far = off(&mesh, 800., 0.);
        assert!(quick[far] < 0.4 * slow[far]);
    }

    #[test]
    fn two_rolls_spread_two_different_fronts() {
        let mesh = plain();
        let reached = |roll| -> Vec<bool> {
            Front {
                chance: Chance::named(roll, "test.front"),
                roughness: 1.,
            }
            .arrivals(&mesh, &[middle(&mesh)], 400., |_, _| Some(1.))
            .iter()
            .map(|at| at.is_finite())
            .collect()
        };
        let (a, b) = (reached(1), reached(2));
        let both = a.iter().zip(&b).filter(|(a, b)| **a && **b).count() as f64;
        let either = a.iter().zip(&b).filter(|(a, b)| **a || **b).count() as f64;
        assert!(both / either < 0.85, "{}", both / either);
        assert_eq!(a, reached(1));
    }

    #[test]
    fn seeping_keeps_the_whole_and_runs_along_open_ground() {
        let mesh = plain();
        let total = |values: &[f64]| values.iter().sum::<f64>();
        let patches = Patches::of(Chance::named(5, "test.seep").noise(300., 2));
        let free = |cell: usize| patches.covers(mesh.position(cell), 0.5);
        // Poured on open ground nearest the middle.
        let source = (0..mesh.len())
            .filter(|&cell| free(cell))
            .min_by(|a, b| from_middle(&mesh, *a).total_cmp(&from_middle(&mesh, *b)))
            .unwrap();
        let poured = |open: &dyn Fn(usize) -> f64| {
            let mut values = vec![0.0; mesh.len()];
            values[source] = 1_000.;
            for _ in 0..200 {
                seep(&mesh, &mut values, 0.9, open);
            }
            values
        };
        // Evenly open ground: a mound that falls off with distance.
        let even = poured(&|_| 1.);
        assert!((total(&even) - 1_000.).abs() < 1e-6);
        assert!(even[source] < 100.);
        // Patchy ground: the same amount, lying mostly on the open patches.
        let patchy = poured(&|cell| if free(cell) { 1. } else { 0.02 });
        assert!((total(&patchy) - 1_000.).abs() < 1e-6);
        let on_open: f64 = (0..mesh.len())
            .filter(|&c| free(c))
            .map(|c| patchy[c])
            .sum();
        let open_share = (0..mesh.len()).filter(|&c| free(c)).count() as f64 / mesh.len() as f64;
        // Far more of it lies on open ground than open ground's share of the map: about
        // four parts in five on little more than half the ground.
        assert!(
            on_open / 1_000. > open_share + 0.15,
            "{} {open_share}",
            on_open / 1_000.
        );
        // Nothing seeps where the ground is shut.
        let mut shut = vec![0.0; mesh.len()];
        shut[middle(&mesh)] = 7.;
        seep(&mesh, &mut shut, 0.9, |_| 0.);
        assert_eq!(shut[middle(&mesh)], 7.);
    }
}
